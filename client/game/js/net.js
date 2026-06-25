import { connectWS } from '/shared/ws.js';
import { state } from './state.js';
import { appendMsg } from './render.js';

const WS_PROTOCOL = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTOCOL}//${location.host}`;

let _connection = null;
let _messageHandler = null;
let _whoModalHandler = null;

export function initNet(messageHandler) {
  _messageHandler = messageHandler;
  _connection = connectWS(WS_URL, {
    onOpen() {
      setConnStatus('online');
      hideColdStart();
      const reconnectToken = sessionStorage.getItem('reconnect-token');
      if (reconnectToken && state.player) {
        // Silent reconnect — token validated server-side; auth_success or auth_fail follows
        _connection.send({ type: 'auth_reconnect', token: reconnectToken });
      } else {
        if (state.player) appendMsg(`Connected to ARCHITECT as ${state.player.handle}.`, 'system');
        else if (!sessionStorage.getItem('welcome-shown')) {
          sessionStorage.setItem('welcome-shown', '1');
          appendMsg('Welcome to ARCHITECT.', 'system');
        }
        const switchToken = sessionStorage.getItem('game-switch-token');
        if (switchToken && !state.player) {
          sessionStorage.removeItem('game-switch-token');
          _connection.send({ type: 'auth_token', token: switchToken });
        } else if (!state.player) {
          // Auto-login with remembered credentials
          const username = localStorage.getItem('mud_remember_user');
          const password = localStorage.getItem('mud_remember_pass');
          if (username && password) {
            _connection.send({ type: 'auth', username, password });
          }
        }
      }
    },
    onRetry() {
      setConnStatus('reconnecting');
    },
    onClose() {
      setConnStatus('offline');
      if (state.authPending) {
        clearTimeout(state.authTimeout);
        state.authPending = false;
        const submitBtn = document.getElementById('auth-submit');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = state.isRegister ? 'Register' : 'Enter';
        }
        const errEl = document.getElementById('auth-error');
        if (errEl) {
          errEl.textContent = 'Connection lost during login. Reconnecting...';
          errEl.style.color = 'var(--red)';
        }
      }
    },
    onColdStart(showing) {
      if (showing) showColdStart();
    },
    onMessage(msg) { _messageHandler?.(msg); },
  });
}

export function setWhoModalHandler(fn) { _whoModalHandler = fn; }

export function sendCmd(cmd) {
  if (!_connection?.isOpen()) return;
  if (cmd.trim().toLowerCase() === 'who' && _whoModalHandler) { _whoModalHandler(); return; }
  appendMsg(`> ${cmd}`, 'echo');
  _connection.send({ type: 'command', command: cmd });
}

export function sendCmdSilent(cmd) {
  if (!_connection?.isOpen()) return;
  _connection.send({ type: 'command', command: cmd });
}

export function sendDialogue(npcId, choice) {
  _connection?.send({ type: 'dialogue', npcId, choice });
}

export function buyFromNpc(npcId, itemId) {
  _connection?.send({ type: 'buy_npc', npcId, itemId });
}

export function closeConnection() {
  _connection?.close();
}

export function attemptAutoReauth() {
  const reconnectToken = sessionStorage.getItem('reconnect-token');
  if (reconnectToken && state.player) {
    _connection?.send({ type: 'auth_reconnect', token: reconnectToken });
    return;
  }
  // Fall back to stored credentials if available
  const username = localStorage.getItem('mud_remember_user');
  const password = localStorage.getItem('mud_remember_pass');
  if (username && password) {
    _connection?.send({ type: 'auth', username, password });
    return;
  }
  // No credentials available — show auth screen so the user can log in manually
  state.player = null;
  document.getElementById('auth-screen').style.display = 'flex';
}

export function doAuth() {
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const handle = document.getElementById('auth-handle').value.trim();
  const errEl = document.getElementById('auth-error');
  const submitBtn = document.getElementById('auth-submit');

  if (state.authPending) return;

  const email = document.getElementById('auth-email').value.trim();
  if (!username || !password) { errEl.textContent = 'Username and password required.'; errEl.style.color = ''; return; }
  if (state.isRegister && !handle) { errEl.textContent = 'Handle required.'; errEl.style.color = ''; return; }
  if (state.isRegister && !email) { errEl.textContent = 'Email required.'; errEl.style.color = ''; return; }

  if (_connection?.isConnecting()) {
    errEl.textContent = 'Still connecting to server... try again in a moment.';
    errEl.style.color = 'var(--yellow, #d4c44a)';
    return;
  }
  if (!_connection?.isOpen()) {
    errEl.textContent = 'Not connected. Server may be waking up (free tier cold start ~60s) — reconnecting automatically.';
    errEl.style.color = 'var(--red)';
    return;
  }

  const remember = document.getElementById('auth-remember').checked;
  if (remember) {
    localStorage.setItem('mud_remember_user', username);
    localStorage.setItem('mud_remember_pass', password);
  } else {
    localStorage.removeItem('mud_remember_user');
    localStorage.removeItem('mud_remember_pass');
  }

  errEl.textContent = '';
  state.authPending = true;
  submitBtn.disabled = true;
  submitBtn.textContent = state.isRegister ? 'Registering...' : 'Logging in...';

  state.authTimeout = setTimeout(() => {
    state.authPending = false;
    submitBtn.disabled = false;
    submitBtn.textContent = state.isRegister ? 'Register' : 'Enter';
    errEl.textContent = 'No response from server. Check your connection and try again.';
    errEl.style.color = 'var(--red)';
  }, 10000);

  if (state.isRegister) {
    const biological_sex = document.querySelector('input[name="auth-sex"]:checked')?.value || 'male';
    fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, handle, biological_sex, email }),
    }).then(r => r.json()).then(data => {
      if (data.error) {
        clearTimeout(state.authTimeout);
        state.authPending = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Register';
        errEl.textContent = data.error;
        errEl.style.color = 'var(--red)';
        return;
      }
      _connection.send({ type: 'auth', username, password });
    }).catch(err => {
      clearTimeout(state.authTimeout);
      state.authPending = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Register';
      errEl.textContent = 'Registration request failed: ' + err.message;
      errEl.style.color = 'var(--red)';
    });
  } else {
    _connection.send({ type: 'auth', username, password });
  }
}

export async function doForgotPassword() {
  const email = state.send_password;
  const msgEl = document.getElementById('forgot-message');
  const btn   = document.getElementById('forgot-submit');
  if (!email) { msgEl.textContent = 'That email address is not associated with that username.'; msgEl.style.color = 'var(--red)'; return; }
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    const data = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).then(r => r.json());
    if (data.error) {
      msgEl.textContent = data.error;
      msgEl.style.color = 'var(--red)';
    } else {
      msgEl.textContent = data.message || 'Check your email.';
      msgEl.style.color = 'var(--accent)';
    }
  } catch {
    msgEl.textContent = 'Request failed. Try again.';
    msgEl.style.color = 'var(--red)';
  }
  btn.disabled = false;
  btn.textContent = 'Send Reset Link';
}

export async function doResetPassword(token) {
  const pw    = document.getElementById('reset-password').value;
  const pw2   = document.getElementById('reset-password-confirm').value;
  const errEl = document.getElementById('reset-error');
  const btn   = document.getElementById('reset-submit');
  if (!pw || pw !== pw2) { errEl.textContent = 'Passwords do not match.'; errEl.style.color = 'var(--red)'; return; }
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    const data = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: pw }),
    }).then(r => r.json());
    if (data.error) {
      errEl.textContent = data.error;
      errEl.style.color = 'var(--red)';
    } else {
      errEl.textContent = data.message;
      errEl.style.color = 'var(--accent)';
      setTimeout(() => {
        document.getElementById('reset-screen').style.display = 'none';
        document.getElementById('auth-screen').style.display = 'flex';
        history.replaceState({}, '', location.pathname);
      }, 2000);
    }
  } catch {
    errEl.textContent = 'Request failed.';
    errEl.style.color = 'var(--red)';
  }
  btn.disabled = false;
  btn.textContent = 'Set New Password';
}

const CONN_ICONS = { online: '●', reconnecting: '◌', offline: '●' };
const CONN_TITLES = { online: 'Connected', reconnecting: 'Reconnecting…', offline: 'Disconnected' };

export function setConnStatus(stateStr) {
  const el = document.getElementById('conn-status');
  el.className = `conn-status ${stateStr}`;
  el.textContent = CONN_ICONS[stateStr] ?? '●';
  el.title = CONN_TITLES[stateStr] ?? '';
}

function showColdStart() {
  let el = document.getElementById('cold-start-notice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cold-start-notice';
    el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--bg2);border:1px solid var(--accent);padding:24px;text-align:center;z-index:300;border-radius:2px;max-width:320px';
    el.innerHTML = '<div style="color:var(--accent);font-size:13px;letter-spacing:2px;margin-bottom:8px">ARCHITECT</div><div style="color:var(--text-dim);font-size:12px;line-height:1.6">Server is waking up.<br>Free tier cold start — about 60 seconds.<br><span style="color:var(--text);font-size:11px">Reconnecting automatically...</span></div>';
    document.body.appendChild(el);
  }
  el.style.display = 'block';
}

function hideColdStart() {
  const el = document.getElementById('cold-start-notice');
  if (el) el.style.display = 'none';
}

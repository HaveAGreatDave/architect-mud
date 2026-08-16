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
      const signedOut = sessionStorage.getItem('signed-out');
      if (signedOut) {
        // Show auth screen — don't auto-login; flag cleared on auth_success
        document.getElementById('auth-screen').style.display = 'flex';
        return;
      }
      const reconnectToken = sessionStorage.getItem('reconnect-token');
      if (reconnectToken && state.player) {
        // Silent reconnect — token validated server-side; auth_success or auth_fail follows
        _connection.send({ type: 'auth_reconnect', token: reconnectToken });
      } else {
        // No greeting here — pre-auth we don't know who you are yet. The log's
        // welcome line is written on auth_success (dispatch.js) using the exact
        // words the Architect's welcome voice speaks.
        if (state.player) appendMsg(`Connected to ARCHITECT as ${state.player.handle}.`, 'system');
        const switchToken = sessionStorage.getItem('game-switch-token');
        if (switchToken && !state.player) {
          sessionStorage.removeItem('game-switch-token');
          _connection.send({ type: 'auth_token', token: switchToken });
        } else if (!state.player) {
          // Auto-login with remembered credentials
          const username = localStorage.getItem('mud_remember_user');
          const password = localStorage.getItem('mud_remember_pass');
          if (username && password) {
            _connection.send({ type: 'auth', username, password, displayRung: storedDisplayRung() });
          }
        }
      }
    },
    onRetry() {
      setConnStatus('reconnecting');
    },
    onClose() {
      setConnStatus('offline');
      window.dispatchEvent(new Event('game-disconnect'));
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
    // Both directions. The old `if (showing)` had no else, so the overlay could
    // only ever be taken down by a fresh onOpen or the DB's `awake` — and if it
    // went up after the socket was already back (a late close event from a
    // superseded socket), neither of those was ever coming again and it sat
    // there over a working connection.
    onColdStart(showing) {
      if (showing) showColdStart();
      else hideColdStart();
    },
    onMessage(msg) {
      // DB compute wake (Neon free-tier cold start). Handled here so it reuses
      // the cold-start overlay; never forwarded to the game message handler.
      if (msg.type === 'waking') { showColdStart({ db: true }); return; }
      if (msg.type === 'awake') { hideColdStart(); return; }
      _messageHandler?.(msg);
    },
  });
}

export function setWhoModalHandler(fn) { _whoModalHandler = fn; }

// A client-side minigame can claim a few words while it is open — the character
// breach board's `ping`/`scan`/`breach`/`abort`. Same shape as the `who` intercept
// above: the handler returns true if it took the command, false to let it go to
// the server as normal. This is necessary because a text minigame runs ENTIRELY
// in the client (the server only hands over skill+difficulty and is told the
// result), so there is nothing on the far end to receive these words.
let _minigameCmdHandler = null;
export function setMinigameCommandHandler(fn) { _minigameCmdHandler = fn; }

// ── Dropped-while-disconnected notice ────────────────────────────────────────
// Both senders below return silently when the socket is shut, which is correct (there
// is nowhere to send it) but reads as the FEATURE being broken: clicking Tablet or Kit
// does nothing at all, no error, no console line, and the natural conclusion is that
// the tablet is broken rather than that you're disconnected. Say so instead — once per
// window, because sendCmdSilent also carries the post-move look refresh and a
// disconnected player would otherwise get a wall of identical lines.
// The connection indicator (● / ◌ in the header) is the standing signal; this is the
// nudge for the moment you actually try to do something.
let _dropNoticeAt = 0;
const DROP_NOTICE_MS = 12000;
function noticeDropped() {
  const now = Date.now();
  if (now - _dropNoticeAt < DROP_NOTICE_MS) return;
  _dropNoticeAt = now;
  appendMsg('Not connected — that did nothing. Reconnecting… (if it sticks, reload the page.)', 'system');
}

export function sendCmd(cmd, displayText) {
  if (!_connection?.isOpen()) { noticeDropped(); return; }
  if (cmd.trim().toLowerCase() === 'who' && _whoModalHandler) { _whoModalHandler(); return; }
  // An open client-side minigame gets first refusal on its own words.
  if (_minigameCmdHandler && _minigameCmdHandler(cmd.trim().toLowerCase())) { appendMsg(`> ${displayText || cmd}`, 'echo'); return; }
  // Explicit user look should echo the room description into the scrolling log,
  // not just refresh the top area pane. Silent looks (combat/move refresh) use
  // sendCmdSilent and never set this flag.
  if (/^(l|look)(\s+(room|around))?$/.test(cmd.trim().toLowerCase())) state.echoNextLook = true;
  appendMsg(`> ${displayText || cmd}`, 'echo');
  _connection.send({ type: 'command', command: cmd });
}

export function sendCmdSilent(cmd) {
  if (!_connection?.isOpen()) { noticeDropped(); return; }
  // silent: client automation (post-move look refresh, tablet re-nav polls) —
  // the server excludes these from idle-logoff activity stamping.
  _connection.send({ type: 'command', command: cmd, silent: true });
}

export function sendDialogue(npcId, choice, optionIndex) {
  _connection?.send({ type: 'dialogue', npcId, choice, optionIndex: optionIndex ?? null });
}

export function buyFromNpc(npcId, itemId, quantity = 1) {
  _connection?.send({ type: 'buy_npc', npcId, itemId, quantity });
}

// One frame for a whole shelf. The server loops and answers with a single panel
// — see handleBuyManyFromNpc for why this isn't N calls to buyFromNpc.
export function buyManyFromNpc(npcId, itemIds) {
  _connection?.send({ type: 'buy_many_npc', npcId, itemIds });
}

export function sellToNpc(npcId, inventoryId, quantity = 1) {
  _connection?.send({ type: 'sell_npc', npcId, inventoryId, quantity });
}

export function sellAllToNpc(npcId) {
  _connection?.send({ type: 'sell_all_npc', npcId });
}

export function sendRaw(msg) {
  if (!_connection?.isOpen()) return false;
  _connection.send(msg);
  return true;
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

// ── Pre-login Display Mode ───────────────────────────────────────────────────
// Its OWN localStorage key, deliberately not part of `architect_settings`: that
// bag is per-character client chrome, and this has to be readable before we know
// who is logging in. The server is the authority the moment you're authenticated
// (see finishAuth) — this is only ever a seed and a memory of what you last
// picked on this machine.
const DISPLAY_PREF_KEY = 'architect_display_rung_pref';
const RUNGS = ['visual', 'textgames', 'log'];

// The radio the player actually chose, or null. Null means UNTOUCHED, and that
// travels all the way to the server as "send nothing" — an explicit `visual`
// would collapse the never-chosen state that poker's called-aloud felt reads.
function pickedDisplayRung() {
  const el = document.querySelector('input[name="auth-display"]:checked');
  const v = el && el.value;
  return RUNGS.includes(v) ? v : null;
}

// DID THEY TOUCH IT THIS TIME? — the difference between a seed and an order.
//
// `restoreDisplayRungPref` pre-checks last time's answer, so a checked radio is
// NOT evidence of a choice: an untouched screen carrying a restored `log` looks
// identical to one somebody just clicked. The server rightly refuses to let a
// mere seed overwrite a rung already stored on the account — otherwise a library
// computer would reset the phone you set it on.
//
// But that made picking a rung on the login screen do NOTHING for every account
// that had ever set one, which is every account that has been to Settings. The
// player clicks Log, logs in, and gets the graphical game — nothing tells them
// why. So the two cases are told apart here rather than guessed at over there:
// a radio the player pressed in THIS visit is an explicit instruction and wins,
// and everything else stays a seed that only fills an empty slot.
let displayRungTouched = false;

// THE WAY IN HAS TO MATCH THE RUNG THEY JUST PICKED.
//
// The guide link under the form points at the illustrated contents page, which is
// right for almost everybody. But a player who has just ticked `log` has said,
// in the plainest terms available on this screen, that they are reading with a
// screen reader — and the very next thing offered to them was the edition built
// around pictures. Each guide already ships a -text sibling; the anchors carry
// both hrefs as data attributes, so this only ever swaps between two authored
// pages and can never invent a URL.
//
// `log` alone, not `textgames`: the middle rung keeps maps and panels, so the
// illustrated pages still describe the game that player is going to see.
function syncGuideLinkRung(rung) {
  const key = rung === 'log' ? 'guideLog' : 'guideVisual';
  for (const a of document.querySelectorAll('#guide-link-wrap a[data-guide-visual]')) {
    const href = a.dataset[key];
    if (href) a.href = href;
  }
}

// Bound once at init on the fieldset, so it survives the radios being re-rendered
// and needs no per-input listener.
export function watchDisplayRungChoice() {
  const set = document.querySelector('.auth-display-set');
  if (!set) return;
  set.addEventListener('change', (e) => {
    if (e.target?.name === 'auth-display') {
      displayRungTouched = true;
      syncGuideLinkRung(e.target.value);
    }
  });
}

// The remembered choice, for paths that never show the auth screen at all
// (auto-login with saved credentials). Same null-means-UNTOUCHED contract as
// pickedDisplayRung — the radios simply aren't there to read.
function storedDisplayRung() {
  let v = null;
  try { v = localStorage.getItem(DISPLAY_PREF_KEY); } catch { /* private mode */ }
  return RUNGS.includes(v) ? v : null;
}

// Restore the last choice into the radios, and open the disclosure if there is
// one — a player who picked `log` last time should not have to go hunting for
// the link again to confirm it stuck.
export function restoreDisplayRungPref() {
  let v = null;
  try { v = localStorage.getItem(DISPLAY_PREF_KEY); } catch { /* private mode */ }
  if (!RUNGS.includes(v)) return;
  const el = document.querySelector(`input[name="auth-display"][value="${v}"]`);
  if (!el) return;
  el.checked = true;
  // A restored `log` is still a player who reads with a screen reader, even
  // though they haven't touched anything this visit — the links follow the rung
  // that is showing, not the one that was clicked.
  syncGuideLinkRung(v);
  // Open it only for a rung the player went LOOKING for. `visual` is the ordinary
  // graphical game, so restoring it used to throw the whole accessibility panel
  // open on every visit for the majority of players — a wall of radio buttons
  // between them and the ENTER button, answering a question they never asked.
  // Someone who chose `log` or `textgames` does want to see it stuck; nobody
  // needs confirmation that the normal thing is still normal.
  //
  // Collapsed is not a downgrade for assistive tech: a <summary> is a real
  // button, announced with its own expanded/collapsed state, reachable in tab
  // order and in a screen reader's element list. It is a disclosure, not a
  // hidden setting.
  if (v === 'visual') return;
  const details = document.getElementById('auth-display-details');
  if (details) details.open = true;
}

// Called on auth_success with the rung the server actually settled on, so the
// auth screen reflects reality next visit rather than a stale local guess.
export function rememberDisplayRung(rung) {
  try {
    if (RUNGS.includes(rung)) localStorage.setItem(DISPLAY_PREF_KEY, rung);
    else localStorage.removeItem(DISPLAY_PREF_KEY);
  } catch { /* private mode */ }
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
    errEl.textContent = 'Not connected. The server may still be waking up (up to a minute) — reconnecting automatically.';
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

  // Ride the auth message rather than following it. A `displaymode` command sent
  // after auth_success loses the race: the prologue's `player.login` handler has
  // already pushed the cold open by then, which is the one thing this exists to
  // let a screen-reader player skip.
  const displayRung = pickedDisplayRung();
  // Only a rung pressed in this visit is an instruction; a restored one is a
  // seed. Registration is always a fresh account, so the distinction is moot
  // there and the flag rides along either way.
  const displayRungExplicit = displayRungTouched && !!displayRung;
  if (displayRung) rememberDisplayRung(displayRung);

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
    fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, handle, email, displayRung }),
    }).then(r => r.json()).then(data => {
      clearTimeout(state.authTimeout);
      state.authPending = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Register';
      if (data.error) {
        errEl.textContent = data.error;
        errEl.style.color = 'var(--red)';
        return;
      }
      if (data.needsVerification) {
        showVerifyScreen(email, data.emailError
          ? `${data.emailError} Try "Resend" below once mail is working.`
          : 'Account created. Check your email for a verification link before logging in.');
        return;
      }
      _connection.send({ type: 'auth', username, password, displayRung, displayRungExplicit });
    }).catch(err => {
      clearTimeout(state.authTimeout);
      state.authPending = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Register';
      errEl.textContent = 'Registration request failed: ' + err.message;
      errEl.style.color = 'var(--red)';
    });
  } else {
    _connection.send({ type: 'auth', username, password, displayRung, displayRungExplicit });
  }
}

export function showVerifyScreen(email, message) {
  document.getElementById('auth-screen').style.display = 'none';
  const screen = document.getElementById('verify-screen');
  screen.style.display = '';
  document.getElementById('verify-message').textContent = message || 'Check your email for a verification link.';
  document.getElementById('verify-resend-email').value = email || '';
  document.getElementById('verify-error').textContent = '';
  // The auth screen just went display:none out from under the submit button, so
  // focus fell to <body> and nothing was announced. A player who has this second
  // created an account hears silence and cannot tell whether it worked. Land on
  // the message that tells them, which is the only reason this screen exists.
  document.getElementById('verify-message').focus();
}

export async function doResendVerification() {
  const email = document.getElementById('verify-resend-email').value.trim();
  const errEl = document.getElementById('verify-error');
  const btn = document.getElementById('verify-resend-btn');
  if (!email) { errEl.textContent = 'Enter your email address.'; errEl.style.color = 'var(--red)'; return; }
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    const data = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).then(r => r.json());
    if (data.error) {
      errEl.textContent = data.error;
      errEl.style.color = 'var(--red)';
    } else {
      errEl.textContent = 'Sent. Check your inbox.';
      errEl.style.color = 'var(--accent)';
    }
  } catch {
    errEl.textContent = 'Request failed. Try again.';
    errEl.style.color = 'var(--red)';
  }
  btn.disabled = false;
  btn.textContent = 'Resend Verification Email';
}

export async function doForgotPassword() {
  const email = state.send_password;
  // Send the username too — it's unique, so the server can pick the right
  // account when several characters share one email address.
  const username = document.getElementById('forgot-username').value.trim();
  const msgEl = document.getElementById('forgot-message');
  const btn   = document.getElementById('forgot-submit');
  if (!email) { msgEl.textContent = 'That email address is not associated with that username.'; msgEl.style.color = 'var(--red)'; return; }
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    const data = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username }),
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

const CONN_TITLES = { online: 'Connected', reconnecting: 'Reconnecting…', offline: 'Disconnected' };

export function setConnStatus(stateStr) {
  const el = document.getElementById('conn-status');
  // The dot itself is drawn by CSS (::before), never written here — the
  // colourblind status-glyph option needs to change its SHAPE, and a glyph in
  // the text content plus a glyph in the pseudo-element renders two dots.
  el.className = `conn-status ${stateStr}`;
  el.title = CONN_TITLES[stateStr] ?? '';
}

// Cold-start flavour — the terminal doing paperwork out loud while the world
// comes up. Written in the institutional "we" of the welcome voice
// (dispatch.js WELCOME_OMINOUS), NOT as the Architect addressing the player:
// story.md is explicit that it is omnipresent and silent, and a chatty
// machine-god on the loading screen would spend that for a gag. Same reason
// the copy never names the hosting tier — the wait is in-fiction or it's
// nothing.
const COLD_START_LINES = [
  'Locating your body. It was where you left it.',
  'Thawing the city. This takes a moment — it always has.',
  'Waking the night shift. They are not pleased.',
  'Counting the dead. The number is stable. That is unusual.',
  'Recovering your file. Somebody had it open.',
  'Checking the weather. You will not enjoy the weather.',
  'Restoring the streetlights, in the order they were extinguished.',
  'Your seat is still warm. We have been keeping it warm. Ask no further.',
  'Paperwork. There is always paperwork.',
  'Confirming you are not already inside. You are not. Probably.',
  'Rebuilding the rooms you were not in. They notice.',
  'Consulting the record — the record is long, and mostly about you.',
  'Reticulating the Basin. The Basin does not require reticulating.',
  'The lights are coming up. Try to look like you belong here.',
];

let _coldTimer = null;
let _coldBag = [];

// Shuffled bag, not Math.random() per tick: a one-minute wait shows ~9 lines,
// and independent picks would repeat inside that window often enough to read
// as a bug rather than a joke.
function nextColdLine() {
  if (!_coldBag.length) {
    _coldBag = COLD_START_LINES.slice();
    for (let i = _coldBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [_coldBag[i], _coldBag[j]] = [_coldBag[j], _coldBag[i]];
    }
  }
  return _coldBag.pop();
}

function showColdStart(opts = {}) {
  // Two flavours: the connection-level cold start (~60s) and the lighter DB
  // compute wake ({ db: true }, ~a few seconds) signalled by the server's
  // "waking" message. Neither names the hosting tier — that's our plumbing,
  // not something a player can act on. Only the LONG one gets the flavour
  // rotation; three seconds of paperwork jokes is just noise.
  const body = opts.db
    ? '<div style="color:var(--text-dim);font-size:0.75rem;line-height:1.6">Waking the world.<br><span style="color:var(--text);font-size:0.6875rem">Just a moment...</span></div>'
    : '<div style="color:var(--text-dim);font-size:0.75rem;line-height:1.6">Connecting to the world.<br>This can take up to a minute.'
      + '<div class="cold-start-bar" aria-hidden="true"><span></span></div>'
      + '<div id="cold-start-flavour" style="color:var(--text);font-size:0.6875rem;min-height:2.6em;display:flex;align-items:center;justify-content:center"></div>'
      + '<span style="color:var(--text-dim);font-size:0.625rem">Reconnecting automatically...</span></div>';
  let el = document.getElementById('cold-start-notice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cold-start-notice';
    el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--bg2);border:1px solid var(--accent);padding:24px;text-align:center;z-index:300;border-radius:2px;max-width:320px';
    document.body.appendChild(el);
  }
  // The button doesn't replace the automatic retry, it just skips the wait —
  // the backoff has usually grown to 15s by the time anyone is impatient enough
  // to look for it.
  const btn = '<button id="cold-start-retry" style="margin-top:14px;background:transparent;border:1px solid var(--accent);color:var(--accent);font-family:inherit;font-size:0.6875rem;letter-spacing:1px;padding:6px 16px;cursor:pointer;border-radius:2px">RECONNECT NOW</button>';
  el.innerHTML = '<div style="color:var(--accent);font-size:0.8125rem;letter-spacing:2px;margin-bottom:8px">ARCHITECT</div>' + body + btn;
  el.style.display = 'block';

  // ── The accessible equivalent ───────────────────────────────────────────────
  // display-mode's contract: #output is the ONE live region. So when the game
  // log is up (a reconnect mid-session) the flavour is MIRRORED there and the
  // overlay is aria-hidden, or a screen reader reads every line twice. On the
  // login screen there is no #output yet, so the overlay is the only surface
  // and carries the live region itself — that isn't a second live region,
  // it's the only one in play.
  const hasLog = !!state.player && !!document.getElementById('output');
  el.setAttribute('aria-hidden', hasLog ? 'true' : 'false');
  if (hasLog) { el.removeAttribute('role'); el.removeAttribute('aria-live'); }
  else { el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); }

  clearInterval(_coldTimer);
  _coldTimer = null;
  if (!opts.db) {
    const paint = () => {
      const line = nextColdLine();
      const slot = document.getElementById('cold-start-flavour');
      if (slot) slot.textContent = line;
      // Log rung / screen reader gets the identical show, not a stripped one:
      // the humour IS the feature here, so shipping only "Reconnecting..." to
      // the log would be that rung not being done.
      if (hasLog) { try { appendMsg(line, 'system'); } catch { /* log not ready */ } }
    };
    paint();
    // 7s: long enough to read a two-clause line without hurrying, short enough
    // that a 60s wait is a show rather than one sentence going stale.
    _coldTimer = setInterval(paint, 7000);
  }
  el.querySelector('#cold-start-retry').onclick = (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = 'DIALLING...';
    _connection?.retryNow?.();
    // Re-arm rather than leave it dead: if this attempt fails, the overlay stays
    // up and the player gets another go.
    setTimeout(() => { b.disabled = false; b.textContent = 'RECONNECT NOW'; }, 3000);
  };
}

function hideColdStart() {
  // Always kill the timer, even if the node is already gone — an orphaned
  // interval keeps writing paperwork lines into the log of a connected player.
  clearInterval(_coldTimer);
  _coldTimer = null;
  const el = document.getElementById('cold-start-notice');
  if (el) el.style.display = 'none';
}

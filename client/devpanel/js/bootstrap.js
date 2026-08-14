document.getElementById('dev-password').addEventListener('keydown', e => { if(e.key==='Enter') devLogin(); });

// ── Ops mode ────────────────────────────────────────────────────────────────
// The panel is served at two URLs from ONE file. /dev is the full builder (local
// worldbuilding); /admin is the ops view for production, where world content is
// read-only (the server's CONTENT_READONLY gate) and only player/live-world
// management makes sense. Prod 302s bare /dev → /admin, so the game's Dev button
// needs no environment awareness of its own.
window.OPS_MODE = location.pathname.replace(/\/+$/, '') === '/admin';

// The read-only marker. An emoji 🔒 carries its own colour and ignores the theme,
// so it sat in the nav as the one thing on the page that never changed with the
// accent. Drawn instead, in currentColor, and pointed at --accent in styles.css.
const OPS_LOCK_SVG = '<svg class="ops-lock" viewBox="0 0 10 12" aria-hidden="true">'
  + '<path d="M2.6 5.2V3.4a2.4 2.4 0 0 1 4.8 0v1.8" fill="none" stroke="currentColor" stroke-width="1.2"/>'
  + '<rect x="0.8" y="5.2" width="8.4" height="6.2" rx="1.2" fill="currentColor"/></svg>';
if (window.OPS_MODE) {
  document.body.classList.add('ops-mode');
  document.title = 'Architect — Admin';
  const logoTag = document.querySelector('#header .logo span');
  if (logoTag) logoTag.textContent = '// ADMIN';
  const nav = document.getElementById('nav');
  // The nav is 1:1 with /dev — nothing is removed. Panels the server won't accept
  // a write for (OPS_WRITABLE_PANELS in core/panels.js) are marked 🔒 so you know
  // before you click that nothing in there will save, and the toggle below hides
  // them. Default is hidden, so the ops nav opens as the short live-world list it
  // has always been; showing the rest is one click, not a different URL.
  nav.querySelectorAll('.nav-item[data-panel]').forEach(n => {
    if (!opsPanelReadOnly(n.dataset.panel)) return;
    n.dataset.opsRo = '1';
    n.textContent = n.textContent.trim() + ' ';
    n.insertAdjacentHTML('beforeend', OPS_LOCK_SVG);
    n.title = 'Read-only on production — look all you like; edit locally and deploy';
  });
  // "World" keeps its live-world ops (Crime/Flight/Power/Bank); with the content
  // panels only viewable under it, the plain label would oversell what it does.
  nav.querySelectorAll('.nav-section').forEach(s => {
    if (s.textContent.trim() === 'World') s.textContent = 'Live World';
  });
  nav.insertAdjacentHTML('afterbegin',
    '<label id="ops-ro-toggle" title="Show the panels that are read-only on production">'
    + '<input type="checkbox" id="ops-ro-checkbox" onchange="setOpsShowReadonly(this.checked)"> show read-only ' + OPS_LOCK_SVG + '</label>');
  const show = localStorage.getItem('devpanel-ops-show-ro') === '1';
  document.getElementById('ops-ro-checkbox').checked = show;
  applyOpsReadonlyVisibility(show);
}

function setOpsShowReadonly(show) {
  localStorage.setItem('devpanel-ops-show-ro', show ? '1' : '0');
  applyOpsReadonlyVisibility(show);
}

// Hiding the read-only entries would leave section headers standing over nothing,
// so a section goes with the last visible item under it.
function applyOpsReadonlyVisibility(show) {
  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.querySelectorAll('.nav-item[data-ops-ro]').forEach(n => { n.style.display = show ? '' : 'none'; });
  nav.querySelectorAll('.nav-section').forEach(s => {
    let sib = s.nextElementSibling, any = false;
    while (sib && !sib.classList.contains('nav-section')) {
      if (sib.classList.contains('nav-item') && sib.style.display !== 'none') { any = true; break; }
      sib = sib.nextElementSibling;
    }
    s.style.display = any ? '' : 'none';
  });
}

// ── Boot splash ─────────────────────────────────────────────────────────────
// SimCity's loader, in the engine's own voice. Two rules keep it from being the
// thing that makes the panel feel slow:
//   1. It is ARMED, not shown. If the first panel resolves inside ARM_DELAY the
//      splash never paints at all, so a warm cache still opens instantly.
//   2. Once it HAS painted it stays up for MIN_VISIBLE, because a splash that
//      blinks out after 40ms reads as a glitch rather than as a load.
// The first line is always the wake-up; the rest start at a random offset so the
// same three jokes aren't the ones you read every morning.
const BOOT_ARM_DELAY = 120;
const BOOT_MIN_VISIBLE = 700;
// Held after the bar hits 100% — long enough to read as finished, short enough
// that it is never what you are waiting for.
const BOOT_SETTLE = 420;
const BOOT_WAKE_LINE = 'Waking THOMAS…';
const BOOT_LINES = [
  'Reticulating exits…',
  'Proofreading the weather…',
  'Teaching the vending machines to lie…',
  'Counting the rats. Twice.',
  'Aligning the Curtain…',
  'Asking the NPCs where they were last night…',
  'Warming the neon…',
  'Sweeping yesterday out of the gutters…',
  'Deciding what the sky is doing…',
  'Paying the power bill…',
  'Checking the sewers for volunteers…',
  'Rounding the odds in the house\'s favour…',
  'Feeding the cat…',
  'Setting the clocks to something plausible…',
  'Filing the sharp edges off the economy…',
];
let _bootArmTimer = null, _bootCycleTimer = null, _bootShownAt = 0;

// ── The bar ─────────────────────────────────────────────────────────────────
// It reports real milestones (bootSplashStep), never a timer: a bar that fills
// on a clock is a progress-shaped animation, and it lies as soon as the network
// is slow — which is the only time anybody looks at it.
//
// Between milestones it EASES toward the current target rather than jumping, and
// never reaches it. That is the honest shape of "still working": the bar keeps
// moving during a long fetch without ever claiming a step finished that hasn't.
// 100% belongs to bootSplashDone alone.
const BOOT_MARKS = { shown: 0.12, session: 0.4, panel: 1 };
let _bootTarget = 0, _bootAt = 0, _bootEaseTimer = null;

function bootSplashStep(mark) {
  _bootTarget = Math.max(_bootTarget, BOOT_MARKS[mark] ?? 0);
}

function bootSplashPaintBar() {
  const fill = document.getElementById('boot-bar-fill');
  if (fill) fill.style.width = `${Math.round(_bootAt * 100)}%`;
}

function bootSplashArm() {
  _bootArmTimer = setTimeout(() => {
    _bootArmTimer = null;
    _bootShownAt = Date.now();
    const el = document.getElementById('boot-splash');
    if (!el) return;
    el.classList.remove('hidden');
    // Who you are, and what the panel will let you do about it. No name is a
    // legitimate state (the panel opened outside the game client), so the line
    // degrades to the role rather than greeting an empty string.
    const welcome = document.getElementById('boot-welcome');
    if (welcome) {
      const who = (typeof devHandle !== 'undefined' && devHandle) ? devHandle : null;
      welcome.textContent = who ? `Welcome back, ${who}. ` : 'Welcome back. ';
      const tag = document.createElement('span');
      tag.className = 'boot-role';
      tag.textContent = `[${devRole}]`;
      welcome.appendChild(tag);
    }
    let i = Math.floor(Math.random() * BOOT_LINES.length);
    const status = document.getElementById('boot-status');
    if (status) status.textContent = BOOT_WAKE_LINE;
    _bootCycleTimer = setInterval(() => {
      const s = document.getElementById('boot-status');
      if (s) s.textContent = BOOT_LINES[i++ % BOOT_LINES.length];
    }, 750);

    bootSplashStep('shown');
    bootSplashPaintBar();
    _bootEaseTimer = setInterval(() => {
      _bootAt += (_bootTarget - _bootAt) * 0.3;
      bootSplashPaintBar();
    }, 160);
  }, BOOT_ARM_DELAY);
}

function bootSplashDone() {
  if (_bootArmTimer) { clearTimeout(_bootArmTimer); _bootArmTimer = null; return; }
  const el = document.getElementById('boot-splash');
  if (!el || el.classList.contains('hidden')) return;
  // Full, and SEEN to be full: the bar lands on 100% while the card is still up,
  // so the last thing you look at is a finished bar rather than a vanishing one.
  if (_bootEaseTimer) { clearInterval(_bootEaseTimer); _bootEaseTimer = null; }
  _bootAt = _bootTarget = 1;
  bootSplashPaintBar();
  const status = document.getElementById('boot-status');
  if (status) status.textContent = 'THOMAS is awake.';
  if (_bootCycleTimer) { clearInterval(_bootCycleTimer); _bootCycleTimer = null; }

  const wait = Math.max(BOOT_SETTLE, BOOT_MIN_VISIBLE - (Date.now() - _bootShownAt));
  setTimeout(() => {
    el.classList.add('fading');
    setTimeout(() => { el.classList.add('hidden'); el.classList.remove('fading'); }, 260);
  }, wait);
}

// Auto-auth if a Bearer token was passed via sessionStorage (e.g. from the game client).
// Token format: base64("playerId:role:timestamp") — decode to get role without a round-trip.
(() => {
  const stored = sessionStorage.getItem('devpanel-token');
  if (!stored) return;
  let role = '';
  try { [devPlayerId, role] = atob(stored).split(':'); } catch { return; }
  if (!['admin','dev','builder','designer'].includes(role)) return;
  token = stored;
  devRole = role;
  // Stashed by the game client next to the token; absent if the panel was opened
  // some other way, in which case everything downstream keeps its old fallback.
  devHandle = sessionStorage.getItem('devpanel-handle') || null;
  document.getElementById('auth-overlay').classList.add('hidden');
  document.getElementById('auth-badge').textContent = devHandle ? `${devHandle} [${role}]` : `[${role}]`;
  document.getElementById('auth-badge').className = 'auth-status ok';
  if (['admin','dev'].includes(role)) document.getElementById('ghost-btn').style.display = '';
  // WHICH PANEL TO OPEN ON. `?panel=` is how the ⇄ Local button (index.html) hands
  // your place over when you jump machines — switching from the deployed panel to
  // your own should not also cost you the screen you were working on.
  //
  // Validated against the nav rather than trusted: the value comes off a URL, and
  // `loadPanel` on a name that does not exist leaves you looking at an empty pane
  // with no way back. Anything unrecognised silently falls back to the dashboard,
  // which is also what a bare /dev has always done.
  let startPanel = 'dashboard';
  try {
    const want = new URLSearchParams(location.search).get('panel');
    if (want && document.querySelector(`.nav-item[data-panel="${CSS.escape(want)}"]`)) startPanel = want;
  } catch {}
  currentPanel = startPanel;
  activatePanelNav(startPanel);
  // The splash comes down when the FIRST PANEL is on screen — not on a timer, so
  // it can never be the thing you are waiting for.
  bootSplashArm();
  setTimeout(() => {
    Promise.resolve(loadPanel(startPanel)).catch(() => {}).then(bootSplashDone);
    startWorldStatePolling(); initMisToggle(); initEmailVerifyToggle(); initRegistrationsToggle(); updateStagingBadge(); showPlayButton(); initWhisperPanel();
    bootSplashStep('session');   // the session is up; only the panel is outstanding
  }, 0);
})();
applyDevSettings();

// ── Mobile drawers ──────────────────────────────────────────────────────────
// On phones the nav and world-state sidebars are off-canvas; these toggle the
// classes the mobile CSS keys off of. Opening one closes the other.
function toggleMobileNav() {
  const l = document.getElementById('layout');
  l.classList.remove('ws-open');
  l.classList.toggle('nav-open');
}
function toggleMobileWorldState() {
  const l = document.getElementById('layout');
  l.classList.remove('nav-open');
  l.classList.toggle('ws-open');
}
function closeMobileDrawers() {
  document.getElementById('layout').classList.remove('nav-open', 'ws-open');
}
// Tapping a nav item navigates then closes the drawer.
document.getElementById('nav').addEventListener('click', e => {
  if (e.target.closest('.nav-item')) closeMobileDrawers();
});

window.addEventListener('storage', e => {
  if (e.key !== SHARED_SETTINGS_KEY) return;
  devSettings = loadDevSettings();
  applyDevSettings();
});

document.addEventListener('DOMContentLoaded', () => {
  populateThemeGrid();
  const themeGrid = document.getElementById('dev-opt-theme-grid');
  if (themeGrid) {
    themeGrid.addEventListener('click', (e) => {
      const chip = e.target.closest('.theme-chip');
      if (!chip || !themeGrid.contains(chip)) return;
      const val = chip.dataset.value;
      devSettings.theme = val;
      if (BUILTIN_THEME_VALUES.includes(val)) devSettings.customColors = {};
      _themeEditLoaded = false;
      saveDevSettings(devSettings);
      applyDevSettings();
    });
  }

  document.querySelectorAll('#dev-opt-fontsize .dev-settings-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      devSettings.fontSize = btn.dataset.value;
      saveDevSettings(devSettings);
      applyDevSettings();
    });
  });

  document.querySelectorAll('#dev-opt-density .dev-settings-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      devSettings.density = btn.dataset.value;
      saveDevSettings(devSettings);
      applyDevSettings();
    });
  });

  document.querySelectorAll('#dev-opt-motion .dev-settings-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      devSettings.motion = btn.dataset.value;
      saveDevSettings(devSettings);
      applyDevSettings();
    });
  });

  document.querySelectorAll('#dev-opt-tempunit .dev-settings-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      devSettings.tempUnit = btn.dataset.value;
      saveDevSettings(devSettings);
      applyDevSettings();
    });
  });

  const contrastSlider = document.getElementById('dev-opt-contrast');
  const contrastLabel  = document.getElementById('dev-contrast-label');
  const contrastSave   = document.getElementById('dev-contrast-save');
  const contrastRestore = document.getElementById('dev-contrast-restore');

  if (contrastSlider) {
    contrastSlider.addEventListener('input', () => {
      const val = parseInt(contrastSlider.value, 10);
      if (contrastLabel) contrastLabel.textContent = val === 0 ? 'Base' : `+${val}%`;
      devSettings._contrastPreview = val;
      saveDevSettings(devSettings);
      applyDevSettings();
    });
  }
  if (contrastSave) {
    contrastSave.addEventListener('click', () => {
      devSettings.contrast = parseInt(contrastSlider?.value ?? 0, 10);
      delete devSettings._contrastPreview;
      saveDevSettings(devSettings);
      applyDevSettings();
    });
  }
  if (contrastRestore) {
    contrastRestore.addEventListener('click', () => {
      devSettings.contrast = 0;
      delete devSettings._contrastPreview;
      if (contrastSlider) contrastSlider.value = 0;
      if (contrastLabel) contrastLabel.textContent = 'Base';
      saveDevSettings(devSettings);
      applyDevSettings();
    });
  }
});

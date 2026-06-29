// Television popup panel — receives live broadcast push via the existing WS tick.
// Opened by 'watch tv' / 'tv' commands; closed by ESC or the close button.

let _tvOpen = false;
let _tvActiveChannelId = null;
const _tvHistory = [];
const MAX_TV_HISTORY = 200;
let _tvAtBottom = true;
let _tickerText = '';
let _tickerAnimating = false;
let _overlayTimer = null;

export function openTvPanel(data) {
  _tvActiveChannelId = data.channelId;
  _tvOpen = true;
  _tvHistory.length = 0;
  _tickerText = '';
  _tickerAnimating = false;
  _tvAtBottom = true;

  document.getElementById('tv-station-name').textContent = data.stationName || data.channelName || 'UNKNOWN';
  document.getElementById('tv-channel-num').textContent = `CH ${data.channelNumber ?? '—'}`;
  document.getElementById('tv-program-name').textContent = '';
  document.getElementById('tv-messages').innerHTML = '';

  const inner = document.getElementById('tv-ticker-inner');
  inner.style.animation = 'none';
  inner.textContent = '';

  applyTvTheme(data.theme || null);

  document.getElementById('tv-panel').classList.add('active');
}

export function applyTvTheme(theme) {
  const win = document.getElementById('tv-window');
  if (!win) return;

  // Clear any inline CSS variable overrides
  const vars = ['--tv-bg', '--tv-border', '--tv-text', '--tv-header-color', '--tv-live-color', '--tv-ticker-color'];
  for (const v of vars) win.style.removeProperty(v);

  if (!theme) {
    win.dataset.theme = 'corporate';
    return;
  }

  const map = {
    '--tv-bg': theme.bg_color,
    '--tv-border': theme.border_color,
    '--tv-text': theme.text_color,
    '--tv-header-color': theme.header_color || theme.accent_color,
    '--tv-live-color': theme.live_color,
    '--tv-ticker-color': theme.ticker_color,
  };
  for (const [k, v] of Object.entries(map)) {
    if (v) win.style.setProperty(k, v);
  }
  win.dataset.theme = theme.preset || 'corporate';
}

export function closeTvPanel() {
  _tvOpen = false;
  _tvActiveChannelId = null;
  _clearOverlay();
  document.getElementById('tv-panel').classList.remove('active');
}

export function applyTvOverlay(overlay) {
  _clearOverlay();
  const container = document.getElementById('tv-overlay-container');
  if (!container || !overlay) return;

  let el;
  if (overlay.overlayType === 'lower_third') {
    el = document.createElement('div');
    el.className = 'tv-overlay-lower-third';
    el.innerHTML =
      `<div class="tv-overlay-lt-name">${_esc(overlay.text)}</div>` +
      (overlay.subtext ? `<div class="tv-overlay-lt-sub">${_esc(overlay.subtext)}</div>` : '');
  } else if (overlay.overlayType === 'alert_flash') {
    el = document.createElement('div');
    el.className = 'tv-overlay-alert';
    el.innerHTML =
      `<div class="tv-overlay-alert-title">${_esc(overlay.text)}</div>` +
      (overlay.subtext ? `<div class="tv-overlay-alert-sub">${_esc(overlay.subtext)}</div>` : '');
  }

  if (el) {
    container.appendChild(el);
    if (overlay.duration > 0) {
      _overlayTimer = setTimeout(_clearOverlay, overlay.duration * 1000);
    }
  }
}

function _clearOverlay() {
  if (_overlayTimer) { clearTimeout(_overlayTimer); _overlayTimer = null; }
  const container = document.getElementById('tv-overlay-container');
  if (container) container.innerHTML = '';
}

function _esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function isTvOpen() { return _tvOpen; }
export function getTvActiveChannelId() { return _tvActiveChannelId; }

export function appendTvMessage(text, style) {
  const container = document.getElementById('tv-messages');
  if (!container) return;

  const tag = style === 'ascii_art' ? 'pre' : 'div';
  const el = document.createElement(tag);
  el.className = `tv-msg tv-msg-${style || 'raw'}`;
  el.textContent = text;
  container.appendChild(el);

  _tvHistory.push(el);
  if (_tvHistory.length > MAX_TV_HISTORY) _tvHistory.shift().remove();

  if (_tvAtBottom) container.scrollTop = container.scrollHeight;
}

export function updateTvTicker(text) {
  // Strip the >> << wrapper the broadcast runtime adds
  const clean = text.replace(/^>> /, '').replace(/ <<$/, '').trim();
  if (!clean) return;

  _tickerText = _tickerText ? `${_tickerText}   ●   ${clean}` : clean;

  if (!_tickerAnimating) _startTickerAnimation();
}

function _startTickerAnimation() {
  const inner = document.getElementById('tv-ticker-inner');
  if (!inner || !_tickerText) return;

  _tickerAnimating = true;
  inner.textContent = `${_tickerText}   `;

  // Duration scales with text length for consistent reading speed (~0.13s per char)
  const duration = Math.max(10, _tickerText.length * 0.13);

  inner.style.animation = 'none';
  inner.offsetHeight; // force reflow to restart
  inner.style.animation = `tv-ticker-scroll ${duration}s linear forwards`;

  inner.addEventListener('animationend', function handler() {
    inner.removeEventListener('animationend', handler);
    _tickerText = '';
    _tickerAnimating = false;
    inner.style.animation = 'none';
    inner.textContent = '';
  }, { once: true });
}

export function initTvPanel() {
  document.getElementById('tv-close-btn').addEventListener('click', closeTvPanel);

  document.getElementById('tv-panel').addEventListener('click', e => {
    if (e.target.id === 'tv-panel') closeTvPanel();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _tvOpen) closeTvPanel();
  });

  // Track scroll position to know if we're in live mode (at bottom)
  const content = document.getElementById('tv-content');
  content.addEventListener('scroll', () => {
    _tvAtBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 40;
    document.getElementById('tv-live-badge')?.classList.toggle('tv-scrolled', !_tvAtBottom);
  });
}

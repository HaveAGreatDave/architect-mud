// Television popup panel — receives live broadcast push via the existing WS tick.
// Opened by 'watch tv' / 'tv' commands; closed by ESC or the close button.

import { sendCmd } from '../net.js';
import { renderMarkup } from '../markup.js';

let _tvOpen = false;
let _tvShuttingDown = false;
let _tvPoweredOff = false;
let _tvActiveChannelId = null;
const _tvHistory = [];
const MAX_TV_HISTORY = 200;
let _tvAtBottom = true;
let _tickerText = '';
let _tickerAnimating = false;
let _overlayTimer = null;
let _tuneTimer = null;
let _tvChannelList = [];   // [{ number, name, channelId }] sorted by number
let _tvFrequency   = 0;    // current dial position (float)
const LOCK_RANGE   = 0.25; // within this many channel-numbers = lock in
const TV_DIAL_MAX  = 9.05; // dial wraps 0.0 → 9.0 → 0.0 (9.0 + 0.05 step = wrap)

export function openTvPanel(data) {
  const wasAlreadyOn = _tvOpen && !_tvPoweredOff;
  _tvActiveChannelId = data.channelId || null;
  _tvOpen = true;
  _tvShuttingDown = false;
  _tvPoweredOff = !data.channelId || data.channelNumber === 0;
  _tvHistory.length = 0;
  _tickerText = '';
  _tickerAnimating = false;
  _tvAtBottom = true;
  _tvChannelList = Array.isArray(data.channelList) ? data.channelList : [];
  // Server (furniture flags.tv_dial_freq) is source of truth; localStorage is only a within-session fallback
  const serverFreq = typeof data.dialFrequency === 'number' ? data.dialFrequency : -1;
  const savedLocal = localStorage.getItem('tv_frequency');
  _tvFrequency = serverFreq >= 0 ? serverFreq : (savedLocal !== null ? parseFloat(savedLocal) : 0);
  if (!isFinite(_tvFrequency) || _tvFrequency < 0 || _tvFrequency >= TV_DIAL_MAX) _tvFrequency = 0;

  document.getElementById('tv-station-name').textContent = data.stationName || data.channelName || '——';
  document.getElementById('tv-channel-num').textContent = (data.channelNumber > 0) ? `CH ${data.channelNumber}` : '——';
  document.getElementById('tv-program-name').textContent = '';
  document.getElementById('tv-messages').innerHTML = '';

  const freqDisplay = document.getElementById('tv-freq-display');
  if (freqDisplay) freqDisplay.textContent = _tvFrequency.toFixed(1);

  const inner = document.getElementById('tv-ticker-inner');
  inner.style.transition = 'none';
  inner.style.transform  = '';
  inner.textContent = '';
  _tickerText = '';
  _tickerAnimating = false;

  applyTvTheme(data.theme || null);
  document.getElementById('tv-panel').classList.add('active');

  if (_tvPoweredOff) {
    // TV is off — dark screen, no animation
    document.getElementById('tv-content').classList.add('tv-hidden');
    const staticEl = document.getElementById('tv-static');
    staticEl.classList.remove('tv-static-on', 'tv-static-fade', 'tv-static-loop');
    staticEl.style.opacity = '';
  } else if (!wasAlreadyOn) {
    // CRT power-on: expand from bright line, then reveal content
    const content  = document.getElementById('tv-content');
    const staticEl = document.getElementById('tv-static');
    content.classList.add('tv-hidden');
    staticEl.classList.remove('tv-static-fade', 'tv-static-loop');
    staticEl.style.opacity = '1';
    staticEl.classList.add('tv-static-on');
    _playCrtPowerOn();
    _tuneTimer = setTimeout(() => {
      staticEl.classList.remove('tv-static-on');
      staticEl.classList.add('tv-static-fade');
      content.classList.remove('tv-hidden');
      staticEl.addEventListener('animationend', () => staticEl.classList.remove('tv-static-fade'), { once: true });
      _tuneTimer = null;
    }, 720);
  }
}

function _playTuneAnimation() {
  if (_tuneTimer) { clearTimeout(_tuneTimer); _tuneTimer = null; }

  const staticEl = document.getElementById('tv-static');
  const content  = document.getElementById('tv-content');
  const knob     = document.getElementById('tv-knob');

  // Hide content, show static — clear inline knob rotation so spin animation plays cleanly
  content.style.opacity = '';
  content.classList.add('tv-hidden');
  staticEl.style.opacity = '';
  staticEl.classList.remove('tv-static-fade');
  knob.style.transform = '';
  staticEl.classList.add('tv-static-on');

  // Spin the knob
  knob.classList.remove('tv-knob-spinning');
  knob.offsetWidth; // force reflow to restart animation
  knob.classList.add('tv-knob-spinning');

  // After knob settles (~1.1s), fade static out and reveal content
  _tuneTimer = setTimeout(() => {
    staticEl.classList.remove('tv-static-on');
    staticEl.classList.add('tv-static-fade');
    content.classList.remove('tv-hidden');

    staticEl.addEventListener('animationend', () => {
      staticEl.classList.remove('tv-static-fade');
    }, { once: true });

    knob.classList.remove('tv-knob-spinning');
    _updateKnobRotation();
    _tuneTimer = null;
  }, 1200);
}

function _playCrtPowerOn() {
  const win = document.getElementById('tv-window');
  const staticEl = document.getElementById('tv-static');

  // Static comes on as the CRT warms up
  staticEl.classList.remove('tv-static-fade', 'tv-static-loop');
  staticEl.style.opacity = '1';
  staticEl.classList.add('tv-static-on');

  win.classList.remove('tv-powering-on');
  win.offsetWidth; // force reflow to restart animation
  win.classList.add('tv-powering-on');
  win.addEventListener('animationend', () => win.classList.remove('tv-powering-on'), { once: true });
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
  _tvShuttingDown = false;
  _tvPoweredOff = false;
  _tvActiveChannelId = null;
  if (_tuneTimer) { clearTimeout(_tuneTimer); _tuneTimer = null; }
  _clearOverlay();
  const win = document.getElementById('tv-window');
  win.classList.remove('tv-shutting-off');
  localStorage.setItem('tv_frequency', _tvFrequency.toFixed(2));
  sendCmd(`_tvfreq ${_tvFrequency.toFixed(2)}`); // persist dial position to furniture flags
  win.style.position = '';
  win.style.left = '';
  win.style.top = '';
  win.style.margin = '';
  document.getElementById('tv-static').classList.remove('tv-static-on', 'tv-static-fade', 'tv-static-loop');
  document.getElementById('tv-content').classList.remove('tv-hidden');
  document.getElementById('tv-panel').classList.remove('active');
}

export function shutdownTvPanel() {
  if (!_tvOpen || _tvShuttingDown) return;
  _tvShuttingDown = true;
  if (_tuneTimer) { clearTimeout(_tuneTimer); _tuneTimer = null; }

  // Brief static flash, then CRT vertical collapse
  const staticEl = document.getElementById('tv-static');
  staticEl.classList.remove('tv-static-fade');
  staticEl.classList.add('tv-static-on');

  setTimeout(() => {
    staticEl.classList.remove('tv-static-on');
    const win = document.getElementById('tv-window');
    win.classList.add('tv-shutting-off');
    win.addEventListener('animationend', () => closeTvPanel(), { once: true });
  }, 280);
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

function _tvTuneTo(num) {
  sendCmd('tune ' + num);
  _playTuneAnimation();
}

function _updateKnobRotation() {
  const rotation = (_tvFrequency / TV_DIAL_MAX) * 360;
  const knobEl = document.getElementById('tv-knob');
  if (knobEl) knobEl.style.transform = `rotate(${rotation}deg)`;
}

export function tvTunerInput(val) {
  _tvFrequency = parseFloat(val);
  const freqDisplay = document.getElementById('tv-freq-display');
  if (freqDisplay) freqDisplay.textContent = _tvFrequency.toFixed(2);
  _updateKnobRotation();

  // If TV was off and user starts tuning, play CRT power-on first
  if (_tvPoweredOff && _tvFrequency > 0) {
    _tvPoweredOff = false;
    document.getElementById('tv-content').classList.add('tv-hidden');
    _playCrtPowerOn();
    return;
  }

  if (!_tvChannelList.length) return;

  const nearest = _tvChannelList.reduce((a, b) =>
    Math.abs(b.number - _tvFrequency) < Math.abs(a.number - _tvFrequency) ? b : a);
  const dist = Math.abs(nearest.number - _tvFrequency);

  const staticEl  = document.getElementById('tv-static');
  const contentEl = document.getElementById('tv-content');
  const chanNumEl = document.getElementById('tv-channel-num');

  // Progressive fade: static fills as you move away, content fades in as you approach
  const staticOpacity  = Math.min(1, dist / LOCK_RANGE);
  const contentOpacity = 1 - staticOpacity;

  if (staticEl) {
    staticEl.style.opacity = staticOpacity.toFixed(2);
    if (staticOpacity > 0) staticEl.classList.add('tv-static-on');
    else staticEl.classList.remove('tv-static-on');
  }
  if (contentEl) {
    contentEl.classList.remove('tv-hidden');
    contentEl.style.opacity = contentOpacity.toFixed(2);
  }
  // Channel number only visible when exactly on an active channel
  if (chanNumEl) chanNumEl.textContent = (dist < 0.01) ? `CH ${nearest.number}` : '——';

  if (dist < LOCK_RANGE && nearest.channelId !== _tvActiveChannelId) {
    _tvTuneTo(nearest.number);
  }
}

export function showTvOffAir(offlineGraphicContent, offlineGraphicType) {
  const staticEl = document.getElementById('tv-static');
  const content  = document.getElementById('tv-content');
  if (!staticEl || !content) return;
  if (offlineGraphicContent) {
    staticEl.classList.remove('tv-static-on', 'tv-static-loop');
    staticEl.style.opacity = '';
    content.classList.remove('tv-hidden');
    appendTvMessage(offlineGraphicContent, offlineGraphicType === 'svg' ? 'svg' : 'ascii_art');
  } else {
    content.classList.add('tv-hidden');
    staticEl.classList.add('tv-static-on', 'tv-static-loop');
    staticEl.style.opacity = '';
  }
}

export function appendTvMessage(text, style) {
  const container = document.getElementById('tv-messages');
  if (!container) return;

  const el = document.createElement(style === 'ascii_art' ? 'pre' : 'div');
  el.className = `tv-msg tv-msg-${style || 'raw'}`;
  if (style === 'svg') {
    el.innerHTML = text;
    const svg = el.querySelector('svg');
    if (svg) {
      // Force SVG to fill panel width at its natural aspect ratio
      svg.setAttribute('width', '100%');
      svg.removeAttribute('height');
      // If no viewBox, infer one from width/height attrs so scaling works
      if (!svg.getAttribute('viewBox')) {
        const w = parseFloat(svg.getAttribute('width')) || 640;
        const h = parseFloat(svg.getAttribute('height')) || 360;
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        svg.setAttribute('width', '100%');
        svg.removeAttribute('height');
      }
    }
  } else if (style === 'ascii_art') {
    el.innerHTML = renderMarkup(text);
    // Scale font-size so the widest line fills the content area.
    // Strip markup tags from text before measuring so tag syntax doesn't inflate line lengths.
    requestAnimationFrame(() => {
      const content = document.getElementById('tv-content');
      if (!content) return;
      const plain = text.replace(/\[[^\]]*\]/g, '');
      const lines = plain.split('\n');
      const maxLen = Math.max(...lines.map(l => l.length), 1);
      const availPx = content.clientWidth - 36;
      const targetPx = Math.min(availPx / (maxLen * 0.6), 18);
      const finalPx  = Math.max(targetPx, 7);
      el.style.fontSize = `${finalPx.toFixed(1)}px`;
    });
  } else {
    el.innerHTML = renderMarkup(text);
  }
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
  const track = document.getElementById('tv-ticker-track');
  if (!inner || !track || !_tickerText) return;

  _tickerAnimating = true;
  inner.style.transition = 'none';
  inner.style.transform  = '';
  inner.textContent = `${_tickerText}   `;
  inner.offsetHeight; // reflow to measure scrollWidth

  const trackW = track.offsetWidth;
  const textW  = inner.scrollWidth;
  const dur    = (trackW + textW) / 80; // 80 px/s constant reading speed

  inner.style.transform = `translateX(${trackW}px)`;
  inner.offsetHeight;
  inner.style.transition = `transform ${dur}s linear`;
  inner.style.transform  = `translateX(${-textW}px)`;

  inner.addEventListener('transitionend', () => {
    _tickerText = '';
    _tickerAnimating = false;
    inner.style.transition = 'none';
    inner.style.transform  = '';
    inner.textContent = '';
  }, { once: true });
}

const TUNE_RESISTANCE = 0.02;  // channel units per pixel dragged

export function initTvPanel() {
  document.getElementById('tv-close-btn').addEventListener('click', shutdownTvPanel);

  // Knob: click cycles channels; drag tunes with high resistance
  const knob = document.getElementById('tv-knob');
  let _knobDragging = false;
  let _knobStartX = 0;
  let _knobStartFreq = 0;
  let _knobMoved = false;

  knob.addEventListener('mousedown', (e) => {
    if (!_tvOpen) return;
    _knobDragging = true;
    _knobStartX = e.clientX;
    _knobStartFreq = _tvFrequency;
    _knobMoved = false;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!_knobDragging) return;
    const dx = e.clientX - _knobStartX;
    if (Math.abs(dx) > 3) _knobMoved = true;
    const rawFreq = _knobStartFreq + dx * TUNE_RESISTANCE;
    const clamped = Math.round(((rawFreq % TV_DIAL_MAX) + TV_DIAL_MAX) % TV_DIAL_MAX * 20) / 20;
    tvTunerInput(clamped);
  });

  document.addEventListener('mouseup', () => { _knobDragging = false; });

  knob.addEventListener('click', () => {
    if (!_tvOpen || _knobMoved) return;
    if (_tvChannelList.length) {
      const idx = _tvChannelList.findIndex(c => c.channelId === _tvActiveChannelId);
      const next = _tvChannelList[(idx + 1) % _tvChannelList.length];
      if (next) {
        _tvFrequency = next.number;
        if (_tvPoweredOff) {
          _tvPoweredOff = false;
          _playCrtPowerOn();
        }
        _tvTuneTo(next.number);
        return;
      }
    }
    if (!_tvPoweredOff) _playTuneAnimation();
  });

  // Mousewheel on knob — fine-tune by half a channel per tick
  knob.addEventListener('wheel', (e) => {
    if (!_tvOpen) return;
    e.preventDefault();
    const delta = -Math.sign(e.deltaY) * 0.05;
    const clamped = Math.round(((_tvFrequency + delta + TV_DIAL_MAX) % TV_DIAL_MAX) * 20) / 20;
    tvTunerInput(clamped);
    const slider = document.getElementById('tv-tuner-slider');
    if (slider) slider.value = clamped;
  }, { passive: false });

  // Draggable TV window
  const header = document.getElementById('tv-header');
  const win = document.getElementById('tv-window');
  let _dragWin = false;
  let _dragWinX = 0, _dragWinY = 0;
  let _winOffX = 0, _winOffY = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('#tv-close-btn')) return;
    _dragWin = true;
    const rect = win.getBoundingClientRect();
    _dragWinX = e.clientX - rect.left;
    _dragWinY = e.clientY - rect.top;
    win.style.position = 'fixed';
    win.style.margin = '0';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!_dragWin) return;
    win.style.left = `${e.clientX - _dragWinX}px`;
    win.style.top  = `${e.clientY - _dragWinY}px`;
  });
  document.addEventListener('mouseup', () => { _dragWin = false; });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _tvOpen) shutdownTvPanel();
  });

  // Track scroll position to know if we're in live mode (at bottom)
  const content = document.getElementById('tv-content');
  content.addEventListener('scroll', () => {
    _tvAtBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 40;
    document.getElementById('tv-live-badge')?.classList.toggle('tv-scrolled', !_tvAtBottom);
  });
}

// Television popup panel — receives live broadcast push via the existing WS tick.
// Opened by 'watch tv' / 'tv' commands; closed by ESC or the close button.

import { sendCmdSilent, sendRaw } from '../net.js';
import { renderMarkup } from '../markup.js';

let _tvOpen = false;
let _tvShuttingDown = false;
let _tvPoweredOff = false;
let _tvActiveChannelId = null;
let _tvOffAir = false;
const _tvHistory = [];
const MAX_TV_HISTORY = 200;
let _clearAfterTitleCard = false;
let _tickerText = '';
let _tickerAnimating = false;
let _overlayTimer = null;
let _tuneTimer = null;
let _tvChannelList = [];   // [{ number, name, channelId }] sorted by number
let _tvFrequency   = 0;    // current dial position (float), quantized to 0.05 steps for display/lock
let _dialRaw       = 0;    // unquantized accumulator driving drag math, avoids feedback-loop stepping
const LOCK_RANGE   = 0.25; // within this many channel-numbers = lock in
const TV_DIAL_MAX  = 9.05; // dial wraps 0.0 → 9.0 → 0.0 (9.0 + 0.05 step = wrap)
let _sweepRaf       = null;
let _wheelTarget    = null;
const DIAL_SWEEP_SPEED = 4; // frequency-units per second — controls how long static shows between channels

// CRT hum is per-viewer UI ambience tied to the panel being open, not shared
// multiplayer state — so unlike channel-change SFX (server-driven via the
// audio plugin's device.tuned listener), it's started/stopped locally here.
const TV_HUM_DEF = {
  id: 'tv_hum_local', category: 'tv', priority: 1, loop: true,
  config: { waveform: 'sine', freq: 60, gain: 0.05, noiseMix: 0.15,
    filter: { type: 'lowpass', freq: 400, q: 0.7 },
    adsr: { a: 0.5, d: 0.1, s: 1, r: 0.5 } },
};

// Static is a continuous noise loop whose gain is ridden live (via
// AudioEngine.setLoopGain) to track however much visual static is showing —
// full while off-channel/searching, fading to silent as a channel locks in.
// Same per-viewer local-only treatment as the hum: it's tied to dial/UI state,
// not shared multiplayer state.
const TV_STATIC_DEF = {
  id: 'tv_static_local', category: 'tv', priority: 1, loop: true,
  config: { waveform: 'noise', noiseMix: 1, gain: 0.6,
    // Broadband highpass (not a narrow bandpass) keeps the harsh full-spectrum
    // hiss instead of thinning it to a single tone. Fast tremolo amplitude-
    // modulates the noise for a crackly/crunchy texture rather than smooth hiss.
    filter: { type: 'highpass', freq: 700, q: 0.5 },
    tremolo: { rate: 35, depth: 0.6 },
    adsr: { a: 0.02, d: 0.02, s: 1, r: 0.3 } },
};

function _setStaticAudio(fraction, rampSeconds) {
  window.AudioEngine?.setLoopGain(TV_STATIC_DEF.id, fraction, rampSeconds);
}

// Classic CRT power-on "thunk": a fast low-to-high pitch rise (degaussing
// coil whine) with a touch of noise for grit. One-shot, local-only — fires
// alongside the existing power-on warm-up animation in _playCrtPowerOn().
const TV_POWER_ON_DEF = {
  id: 'tv_power_on_local', category: 'tv', priority: 3,
  config: { waveform: 'triangle', freq: 80, duration: 0.35, noiseMix: 0.3,
    pitchBend: { to: 600, time: 0.25 },
    filter: { type: 'lowpass', freq: 3000, q: 1 },
    adsr: { a: 0.005, d: 0.15, s: 0.3, r: 0.15 } },
};

// Power-off "zap": the reverse — a quick high-to-low pitch drop as the CRT
// collapses, timed with the vertical-collapse animation in shutdownTvPanel().
const TV_POWER_OFF_DEF = {
  id: 'tv_power_off_local', category: 'tv', priority: 3,
  config: { waveform: 'triangle', freq: 900, duration: 0.3, noiseMix: 0.2,
    pitchBend: { to: 40, time: 0.25 },
    filter: { type: 'lowpass', freq: 4000, q: 1 },
    adsr: { a: 0.001, d: 0.05, s: 0.2, r: 0.2 } },
};

export function openTvPanel(data) {
  const wasAlreadyOn = _tvOpen;
  // The server echoes a tv_panel message back after every player-initiated tune
  // (to push updated station/channel metadata). If the panel is already open,
  // this is just that echo, not a fresh power-on — so sync metadata only and
  // leave the dial position / power animation alone. Re-running the full reset
  // here was snapping the knob back to 0 mid-drag and replaying the power-on
  // static, which made the dial feel like it was fighting the player.
  const isTuneEcho = wasAlreadyOn;

  _tvActiveChannelId = data.channelId || null;
  _tvOpen = true;
  _tvShuttingDown = false;
  _tvPoweredOff = !data.channelId || data.channelNumber === 0;
  if (_tvActiveChannelId) sendRaw({ type: 'tv_watch', channelId: _tvActiveChannelId });
  _tvHistory.length = 0;
  _tickerText = '';
  _tickerAnimating = false;
  _clearAfterTitleCard = false;
  _tvChannelList = Array.isArray(data.channelList) ? data.channelList : [];

  document.getElementById('tv-station-name').textContent = data.stationName || data.channelName || '——';
  document.getElementById('tv-channel-num').textContent = (data.channelNumber > 0) ? `CH ${data.channelNumber}` : '——';
  const pnEl = document.getElementById('tv-program-name');
  pnEl.textContent = '';
  pnEl.style.opacity = '';
  document.getElementById('tv-messages').innerHTML = '';

  const inner = document.getElementById('tv-ticker-inner');
  inner.style.transition = 'none';
  inner.style.transform  = '';
  inner.textContent = '';

  applyTvTheme(data.theme || null);

  if (isTuneEcho) return; // metadata synced; dial position and animations are untouched

  _tvFrequency = 0;
  _dialRaw = 0;
  const freqDisplay = document.getElementById('tv-freq-display');
  if (freqDisplay) freqDisplay.textContent = _tvFrequency.toFixed(1);

  document.getElementById('tv-panel').classList.add('active');
  window.AudioEngine?.loopSound(TV_HUM_DEF);
  window.AudioEngine?.loopSound(TV_STATIC_DEF);
  _setStaticAudio(0);

  if (_tvPoweredOff) {
    // TV opened at 0.0 — show static, content hidden
    document.getElementById('tv-content').classList.add('tv-hidden');
    const staticEl = document.getElementById('tv-static');
    staticEl.classList.remove('tv-static-fade', 'tv-static-loop');
    staticEl.style.opacity = '1';
    staticEl.classList.add('tv-static-on');
    _playCrtPowerOn();
  } else {
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
      _setStaticAudio(0, 0.3);
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
  _tvOffAir = false;
  content.style.opacity = '';
  content.classList.add('tv-hidden');
  staticEl.style.opacity = '';
  staticEl.classList.remove('tv-static-fade');
  knob.style.transform = '';
  staticEl.classList.add('tv-static-on');
  _setStaticAudio(1);

  // Spin the knob
  knob.classList.remove('tv-knob-spinning');
  knob.offsetWidth; // force reflow to restart animation
  knob.classList.add('tv-knob-spinning');

  // After knob settles (~1.1s), fade static out and reveal content (unless off-air)
  _tuneTimer = setTimeout(() => {
    knob.classList.remove('tv-knob-spinning');
    _updateKnobRotation();
    const pn = document.getElementById('tv-program-name');
    if (pn) pn.style.opacity = '1';
    _tuneTimer = null;
    if (_tvOffAir) return;
    staticEl.classList.remove('tv-static-on');
    staticEl.classList.add('tv-static-fade');
    content.classList.remove('tv-hidden');
    staticEl.addEventListener('animationend', () => {
      staticEl.classList.remove('tv-static-fade');
    }, { once: true });
    _setStaticAudio(0, 0.3);
    content.style.opacity = '';
  }, 1200);
}

function _playCrtPowerOn() {
  const win = document.getElementById('tv-window');
  const staticEl = document.getElementById('tv-static');

  // Static comes on as the CRT warms up
  staticEl.classList.remove('tv-static-fade', 'tv-static-loop');
  staticEl.style.opacity = '1';
  staticEl.classList.add('tv-static-on');
  _setStaticAudio(1);
  window.AudioEngine?.playSfx(TV_POWER_ON_DEF);

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
  _tvOffAir = false;
  sendRaw({ type: 'tv_unwatch' });
  if (_tuneTimer) { clearTimeout(_tuneTimer); _tuneTimer = null; }
  if (_sweepRaf) { cancelAnimationFrame(_sweepRaf); _sweepRaf = null; }
  _clearOverlay();
  const win = document.getElementById('tv-window');
  win.classList.remove('tv-shutting-off');
  win.style.position = '';
  win.style.left = '';
  win.style.top = '';
  win.style.margin = '';
  document.getElementById('tv-static').classList.remove('tv-static-on', 'tv-static-fade', 'tv-static-loop');
  document.getElementById('tv-content').classList.remove('tv-hidden');
  document.getElementById('tv-panel').classList.remove('active');
  window.AudioEngine?.stopLoop(TV_HUM_DEF.id);
  window.AudioEngine?.stopLoop(TV_STATIC_DEF.id);
}

export function shutdownTvPanel() {
  if (!_tvOpen || _tvShuttingDown) return;
  _tvShuttingDown = true;
  if (_tuneTimer) { clearTimeout(_tuneTimer); _tuneTimer = null; }

  // Brief static flash, then CRT vertical collapse
  const staticEl = document.getElementById('tv-static');
  staticEl.classList.remove('tv-static-fade');
  staticEl.classList.add('tv-static-on');
  _setStaticAudio(1);

  setTimeout(() => {
    staticEl.classList.remove('tv-static-on');
    _setStaticAudio(0, 0.1);
    const win = document.getElementById('tv-window');
    win.classList.add('tv-shutting-off');
    window.AudioEngine?.playSfx(TV_POWER_OFF_DEF);
    win.addEventListener('animationend', () => closeTvPanel(), { once: true });
  }, 280);
}

export function applyTvOverlay(overlay) {
  _clearOverlay();
  const container = document.getElementById('tv-overlay-container');
  if (!container || !overlay) return;

  let el;
  if (overlay.overlayType === 'text_card') {
    _clearTvMessages();
    el = document.createElement('div');
    el.className = 'tv-overlay-text-card';
    el.innerHTML = _esc(overlay.text).replace(/\n/g, '<br>');
  } else if (overlay.overlayType === 'lower_third') {
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
  if (_sweepRaf) { cancelAnimationFrame(_sweepRaf); _sweepRaf = null; }
  _wheelTarget = null;
  _tvFrequency = num;
  _dialRaw = num;
  _updateKnobRotation();
  sendCmdSilent('tune ' + num);
}

// Sweeps the dial from its current position toward the next/previous channel
// in the list, passing through the static in between (same lock logic as a
// manual drag) rather than snapping straight there. Used by the +/- buttons,
// which exist for touch/no-wheel input but read identically to a slow turn.
function _stepChannel(direction) {
  if (!_tvChannelList.length) return;
  let target;
  if (direction > 0) {
    const next = _tvChannelList.find(c => c.number > _tvFrequency + 0.001);
    target = next ? next.number : _tvChannelList[0].number;
  } else {
    const prior = [..._tvChannelList].reverse().find(c => c.number < _tvFrequency - 0.001);
    target = prior ? prior.number : _tvChannelList[_tvChannelList.length - 1].number;
  }
  _sweepDialTo(target, direction);
}

function _sweepDialTo(targetNumber, direction) {
  if (_sweepRaf) cancelAnimationFrame(_sweepRaf);

  const start = _dialRaw;
  // Unwrap the target so the sweep moves monotonically in the requested
  // direction instead of jumping backward across the wrap point.
  let unwrappedTarget = targetNumber;
  if (direction > 0 && unwrappedTarget <= start) unwrappedTarget += TV_DIAL_MAX;
  if (direction < 0 && unwrappedTarget >= start) unwrappedTarget -= TV_DIAL_MAX;

  const distance = Math.abs(unwrappedTarget - start);
  const duration = Math.max(distance / DIAL_SWEEP_SPEED, 0.15) * 1000;
  const startTime = performance.now();

  function tick(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const raw = start + (unwrappedTarget - start) * t;
    _dialRaw = ((raw % TV_DIAL_MAX) + TV_DIAL_MAX) % TV_DIAL_MAX;
    tvTunerInput(Math.round(_dialRaw * 20) / 20);
    if (t < 1) {
      _sweepRaf = requestAnimationFrame(tick);
    } else {
      _sweepRaf = null;
      _wheelTarget = null;
    }
  }
  _sweepRaf = requestAnimationFrame(tick);
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

  if (!_tvChannelList.length) return;

  const nearest = _tvChannelList.reduce((a, b) =>
    Math.abs(b.number - _tvFrequency) < Math.abs(a.number - _tvFrequency) ? b : a);
  const dist = Math.abs(nearest.number - _tvFrequency);

  const staticEl      = document.getElementById('tv-static');
  const contentEl     = document.getElementById('tv-content');
  const chanNumEl     = document.getElementById('tv-channel-num');
  const programNameEl = document.getElementById('tv-program-name');

  // Progressive fade: static fills as you move away, content fades in as you approach
  const staticOpacity  = Math.min(1, dist / LOCK_RANGE);
  const contentOpacity = 1 - staticOpacity;
  _setStaticAudio(staticOpacity);

  if (staticEl) {
    staticEl.style.opacity = staticOpacity.toFixed(2);
    if (staticOpacity > 0) staticEl.classList.add('tv-static-on');
    else staticEl.classList.remove('tv-static-on');
  }
  if (contentEl) {
    contentEl.classList.remove('tv-hidden');
    contentEl.style.opacity = contentOpacity.toFixed(2);
  }
  // Program name fades in from invisible as you approach the channel frequency
  if (programNameEl) programNameEl.style.opacity = contentOpacity.toFixed(2);
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
  _tvOffAir = true;
  if (offlineGraphicContent && !_tuneTimer) {
    staticEl.classList.remove('tv-static-on', 'tv-static-loop');
    staticEl.style.opacity = '';
    content.classList.remove('tv-hidden');
    appendTvMessage(offlineGraphicContent, offlineGraphicType === 'svg' ? 'svg' : 'ascii_art');
    _setStaticAudio(0, 0.3);
  } else {
    content.classList.add('tv-hidden');
    staticEl.classList.remove('tv-static-fade');
    staticEl.classList.add('tv-static-on', 'tv-static-loop');
    staticEl.style.opacity = '';
    _setStaticAudio(1);
  }
}

export function showTvOnAir() {
  if (!_tvOffAir) return;
  _tvOffAir = false;
  const staticEl = document.getElementById('tv-static');
  const content  = document.getElementById('tv-content');
  if (!staticEl || !content) return;
  staticEl.classList.remove('tv-static-on', 'tv-static-loop');
  staticEl.classList.add('tv-static-fade');
  staticEl.addEventListener('animationend', () => staticEl.classList.remove('tv-static-fade'), { once: true });
  content.classList.remove('tv-hidden');
  _setStaticAudio(0, 0.3);
}

function _clearTvMessages() {
  const container = document.getElementById('tv-messages');
  if (container) container.innerHTML = '';
  _tvHistory.length = 0;
}

export function clearTvMessages() { _clearTvMessages(); }

export function appendTvMessage(text, style) {
  const container = document.getElementById('tv-messages');
  if (!container) return;

  const isTitleCard = style === 'svg' || style === 'ascii_art' || style === 'credits';

  // Clear before title cards, and after them on the next message
  if (isTitleCard || _clearAfterTitleCard) {
    _clearTvMessages();
    _clearAfterTitleCard = false;
  } else {
    // #tv-content has overflow:hidden — if content height exceeds its box, clear and restart
    const tvContent = document.getElementById('tv-content');
    if (tvContent && tvContent.clientHeight > 0 && container.offsetHeight >= tvContent.clientHeight) {
      // Keep the last line so the display doesn't hard-cut mid-thought
      const lastEl = _tvHistory.length ? _tvHistory[_tvHistory.length - 1].cloneNode(true) : null;
      _clearTvMessages();
      if (lastEl) { container.appendChild(lastEl); _tvHistory.push(lastEl); }
    }
  }

  // Flag that the next non-title message should clear the screen
  if (isTitleCard) _clearAfterTitleCard = true;

  if (style === 'credits') {
    const content = document.getElementById('tv-content');
    const wrap = document.createElement('div');
    wrap.className = 'tv-credits-wrap';
    const inner = document.createElement('div');
    inner.className = 'tv-credits-inner';
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        const b = document.createElement('div');
        b.className = 'credits-blank';
        inner.appendChild(b);
        continue;
      }
      // ALL-CAPS short lines become section headers
      const isHeader = trimmed === trimmed.toUpperCase() && trimmed.length < 50 && /[A-Z]/.test(trimmed);
      const p = document.createElement('p');
      p.className = isHeader ? 'credits-header' : 'credits-line';
      p.textContent = trimmed;
      inner.appendChild(p);
    }
    wrap.appendChild(inner);
    container.appendChild(wrap);
    requestAnimationFrame(() => {
      const contentH = content.clientHeight;
      const innerH = inner.scrollHeight;
      inner.style.transform = `translateY(${contentH}px)`;
      inner.offsetHeight;
      inner.style.transition = `transform ${((contentH + innerH) / 50).toFixed(1)}s linear`;
      inner.style.transform = `translateY(${-innerH}px)`;
    });
    _tvHistory.push(wrap);
    if (_tvHistory.length > MAX_TV_HISTORY) _tvHistory.shift().remove();
    return;
  }

  const el = document.createElement(style === 'ascii_art' ? 'pre' : 'div');
  el.className = `tv-msg tv-msg-${style || 'raw'}`;
  if (style === 'svg') {
    el.innerHTML = text;
    const svg = el.querySelector('svg');
    if (svg) {
      if (!svg.getAttribute('viewBox')) {
        const w = parseFloat(svg.getAttribute('width')) || 640;
        const h = parseFloat(svg.getAttribute('height')) || 360;
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      }
      const vbParts = svg.getAttribute('viewBox').split(/[\s,]+/);
      const naturalWidth = parseFloat(vbParts[2]) || 640;
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.style.width = `${naturalWidth}px`;
      svg.style.maxWidth = '100%';
      svg.style.height = 'auto';
      svg.style.display = 'block';
      svg.style.margin = '0 auto';
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


export function initTvPanel() {
  document.getElementById('tv-close-btn').addEventListener('click', shutdownTvPanel);
  window.addEventListener('game-disconnect', () => { if (_tvOpen) shutdownTvPanel(); });

  // Knob: click cycles channels, mousewheel fine-tunes. Drag-to-rotate is
  // disabled for now — it was unreliable to control smoothly — so there's no
  // mousedown/mousemove rotation handling here.
  const knob = document.getElementById('tv-knob');

  knob.addEventListener('click', () => {
    if (!_tvOpen || navigator.maxTouchPoints > 0) return;
    if (_sweepRaf) { cancelAnimationFrame(_sweepRaf); _sweepRaf = null; }
    if (_tvChannelList.length) {
      const idx = _tvChannelList.findIndex(c => c.channelId === _tvActiveChannelId);
      const next = _tvChannelList[(idx + 1) % _tvChannelList.length];
      if (next) {
        _tvFrequency = next.number;
        _dialRaw = next.number;
        _tvTuneTo(next.number);
        return;
      }
    }
    _playTuneAnimation();
  });

  // Mousewheel on knob — sweep 0.25 per tick in 0.05 steps
  knob.addEventListener('wheel', (e) => {
    if (!_tvOpen) return;
    e.preventDefault();
    const delta = -Math.sign(e.deltaY) * 0.25;
    const base = _wheelTarget !== null ? _wheelTarget : _dialRaw;
    _wheelTarget = Math.round(((base + delta + TV_DIAL_MAX) % TV_DIAL_MAX) * 20) / 20;
    _sweepDialTo(_wheelTarget, Math.sign(delta));
  }, { passive: false });

  // +/- buttons: smoothly sweep toward the next/previous channel rather than
  // snapping, so touch/no-wheel users still see the static pass between
  // channels the same way a wheel scrub or drag would show it.
  const tuneDownBtn = document.getElementById('tv-tune-down');
  const tuneUpBtn   = document.getElementById('tv-tune-up');
  tuneDownBtn?.addEventListener('click', () => { if (_tvOpen) _stepChannel(-1); });
  tuneUpBtn?.addEventListener('click',   () => { if (_tvOpen) _stepChannel(1); });

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

}

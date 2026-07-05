import { sendCmdSilent, sendRaw } from '../net.js';

let deckData = null;
let _wasPlaying = false;
let _overlayTimer = null;
const MAX_PREVIEW_LINES = 20;

function _lightLabel(lightState, activeCassetteId) {
  if (lightState === 'green') return 'LIVE';
  if (lightState === 'orange') return activeCassetteId ? 'PLAYING TAPE' : 'ON AIR';
  return 'OFFLINE';
}

// Local-only UI ambience, same per-viewer treatment as the TV hum/static in
// panels/tv.js — tied to this panel's state, not shared multiplayer state.
// category:'tv' so it answers to the TV Audio toggle/volume (this deck is
// part of the broadcast system), not the generic Ambient slider.
// A quiet, droney whir — the deck's idle motor. Lower and softer than before:
// steady low tone (drone) with a gentle tremolo flutter (the whir) and a slow
// analog pitch drift. Soft attack/release so it fades in/out smoothly. It runs
// whenever the deck is powered, not just while a tape spins, and button presses
// never stop it — only closing the panel does.
const MEDIADECK_WHIR_DEF = {
  id: 'mediadeck_whir_local', category: 'tv', priority: 1, loop: true,
  config: { waveform: 'triangle', freq: 105, gain: 0.025, noiseMix: 0.16,
    filter: { type: 'lowpass', freq: 620, q: 0.8 },
    tremolo: { rate: 5.5, depth: 0.12 },
    vibrato: { rate: 0.3, depth: 6 },
    adsr: { a: 0.6, d: 0.1, s: 1, r: 0.6 } },
};

// Professional-grade, chunky transport SFX — layered servo whirr + friction +
// a heavy low clunk, staggered with per-layer `delay` for a mechanical sequence.

// EJECT: hard mechanical spring-release + servo reverse + seat pop, then the
// capstans whirr up as the mechanism spools out. Gains halved from the old,
// louder pass; leading transients tightened so the clunks read as machinery.
const MEDIADECK_EJECT_DEF = {
  id: 'mediadeck_eject_local', category: 'tv', priority: 4,
  config: { layers: [
    { waveform: 'square', freq: 210, duration: 0.04, gain: 0.15, adsr: { a: 0.001, d: 0.025, s: 0, r: 0.015 }, filter: { type: 'lowpass', freq: 1800, q: 1.2 } },
    { waveform: 'sawtooth', freq: 200, duration: 0.22, gain: 0.1, delay: 0.02, pitchBend: { to: 85, time: 0.2 }, adsr: { a: 0.004, d: 0.18, s: 0.25, r: 0.05 }, filter: { type: 'lowpass', freq: 700, q: 1.4 }, tremolo: { rate: 30, depth: 0.4 } },
    { waveform: 'noise', noiseMix: 1, duration: 0.1, gain: 0.14, delay: 0.02, adsr: { a: 0.004, d: 0.09, s: 0, r: 0.02 }, filter: { type: 'highpass', freq: 1500, q: 1.2 } },
    { waveform: 'triangle', freq: 140, duration: 0.22, gain: 0.275, delay: 0.2, pitchBend: { to: 52, time: 0.18 }, adsr: { a: 0.001, d: 0.15, s: 0.15, r: 0.06 }, filter: { type: 'lowpass', freq: 560, q: 1 } },
    // whirring capstans spooling up as the mechanism runs out
    { waveform: 'triangle', freq: 60, duration: 0.42, gain: 0.15, delay: 0.28, pitchBend: { to: 130, time: 0.38 }, adsr: { a: 0.06, d: 0.32, s: 0.3, r: 0.08 }, filter: { type: 'lowpass', freq: 650, q: 1 }, tremolo: { rate: 16, depth: 0.45 } },
  ] },
};

// INSERT: servo grabs + shell friction + heavy seat clunk + latch, then the
// capstans whirr up to speed. Gains halved; transients sharpened for machinery.
const MEDIADECK_INSERT_DEF = {
  id: 'mediadeck_insert_local', category: 'tv', priority: 4,
  config: { layers: [
    { waveform: 'sawtooth', freq: 120, duration: 0.24, gain: 0.11, pitchBend: { to: 200, time: 0.22 }, adsr: { a: 0.01, d: 0.2, s: 0.25, r: 0.05 }, filter: { type: 'lowpass', freq: 750, q: 1.4 }, tremolo: { rate: 32, depth: 0.45 } },
    { waveform: 'noise', noiseMix: 1, duration: 0.14, gain: 0.15, adsr: { a: 0.01, d: 0.11, s: 0, r: 0.03 }, filter: { type: 'bandpass', freq: 1800, q: 1.1 } },
    { waveform: 'triangle', freq: 80, duration: 0.18, gain: 0.35, delay: 0.12, pitchBend: { to: 55, time: 0.14 }, adsr: { a: 0.001, d: 0.13, s: 0, r: 0.05 }, filter: { type: 'lowpass', freq: 500, q: 1 } },
    { waveform: 'square', freq: 190, duration: 0.04, gain: 0.125, delay: 0.26, adsr: { a: 0.001, d: 0.025, s: 0, r: 0.015 }, filter: { type: 'lowpass', freq: 1700, q: 1.2 } },
    // whirring capstans spooling up to playback speed after it seats
    { waveform: 'triangle', freq: 70, duration: 0.44, gain: 0.16, delay: 0.3, pitchBend: { to: 150, time: 0.4 }, adsr: { a: 0.06, d: 0.34, s: 0.35, r: 0.08 }, filter: { type: 'lowpass', freq: 700, q: 1 }, tremolo: { rate: 15, depth: 0.45 } },
  ] },
};

// A chunky mechanical click for every transport/list button — snap + low thunk.
const MEDIADECK_BUTTON_DEF = {
  id: 'mediadeck_button_local', category: 'tv', priority: 5,
  config: { layers: [
    { waveform: 'square', freq: 220, duration: 0.05, gain: 0.35, pitchBend: { to: 90, time: 0.04 }, adsr: { a: 0.001, d: 0.03, s: 0, r: 0.02 }, filter: { type: 'lowpass', freq: 1200, q: 1 } },
    { waveform: 'noise', noiseMix: 1, duration: 0.04, gain: 0.28, adsr: { a: 0.001, d: 0.03, s: 0, r: 0.01 }, filter: { type: 'bandpass', freq: 2500, q: 1.5 } },
    { waveform: 'triangle', freq: 60, duration: 0.09, gain: 0.5, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.03 }, filter: { type: 'lowpass', freq: 400, q: 1 } },
  ] },
};

// Capstan spin-up — a rising motor swell when a tape actually starts playing.
const MEDIADECK_SPINUP_DEF = {
  id: 'mediadeck_spinup_local', category: 'tv', priority: 3,
  config: { layers: [
    { waveform: 'triangle', freq: 70, duration: 0.5, gain: 0.3, pitchBend: { to: 150, time: 0.45 }, adsr: { a: 0.05, d: 0.4, s: 0.4, r: 0.08 }, filter: { type: 'lowpass', freq: 700, q: 1 }, tremolo: { rate: 14, depth: 0.4 } },
    { waveform: 'noise', noiseMix: 1, duration: 0.5, gain: 0.12, adsr: { a: 0.1, d: 0.3, s: 0.3, r: 0.1 }, filter: { type: 'bandpass', freq: 1200, q: 0.8 } },
  ] },
};

// One-liner: chunky click for any deck button press. Never touches the whir.
function _deckClick() { window.AudioEngine?.playSfx(MEDIADECK_BUTTON_DEF); }

// Whirring plays only while a cassette is actively spinning (lightState
// 'orange' — see _deckLightState in plugins/broadcast/index.js); not for
// 'green' (live, no tape) or 'red' (offline). Idempotent either way: loopSound
// no-ops if already looping, stopLoop no-ops if not.
function _setDeckWhir(active) {
  if (active) window.AudioEngine?.loopSound(MEDIADECK_WHIR_DEF);
  else window.AudioEngine?.stopLoop(MEDIADECK_WHIR_DEF.id);
}

export function openMediaDeckPanel(data) {
  deckData = data;
  renderMediaDeckPanel(data);
  document.getElementById('mediadeck-panel').classList.add('active');
  // Whir runs whenever the deck is powered (any state but offline), so it's a
  // constant idle drone rather than only-while-a-tape-spins.
  _setDeckWhir(data.lightState !== 'red');
  // Clear preview on open and subscribe to channel broadcast. Until the first
  // live line arrives (or if the channel is dead air) the screen shows the red
  // [NO BROADCAST] card; any real broadcast line hides it (see below).
  const previewMsgs = document.getElementById('mediadeck-preview-msgs');
  if (previewMsgs) previewMsgs.innerHTML = '';
  _setNoBroadcast(true);
  _clearOverlay();
  if (data.channelId) sendRaw({ type: 'deck_watch', channelId: data.channelId });
}

export function closeMediaDeckPanel() {
  sendRaw({ type: 'deck_unwatch' });
  _clearOverlay();
  document.getElementById('mediadeck-panel').classList.remove('active');
  document.getElementById('mediadeck-load-picker').hidden = true;
  // Clear any drag offset so the deck re-centers next time it opens.
  const box = document.getElementById('mediadeck-box');
  if (box) { box.style.position = ''; box.style.left = ''; box.style.top = ''; box.style.margin = ''; }
  deckData = null;
  _wasPlaying = false;
  _setDeckWhir(false);
}

// Toggle the red [NO BROADCAST] dead-air card over the preview monitor.
function _setNoBroadcast(on) {
  const el = document.getElementById('mediadeck-no-broadcast');
  if (el) el.hidden = !on;
}

export function updateMediaDeckBroadcast(msg) {
  const preview = document.getElementById('mediadeck-preview-msgs');
  if (!preview) return;
  // Server signals dead air: clear the screen and raise the [NO BROADCAST] card.
  if (msg.style === 'no_broadcast') {
    preview.innerHTML = '';
    _setNoBroadcast(true);
    return;
  }
  // Real content is flowing — a live broadcast line, exactly like the TV panel
  // receives — so drop the dead-air card and render the line.
  _setNoBroadcast(false);
  const el = document.createElement('div');
  el.className = 'mediadeck-preview-line';
  // Render by style, mirroring the TV panel (scaled into the small monitor):
  // SVG title cards inject as live markup, ASCII art / credits keep monospace
  // whitespace, tickers read as a marquee line, everything else is plain text.
  const style = msg.style || 'raw';
  if (style === 'svg') {
    el.classList.add('mediadeck-preview-svg');
    el.innerHTML = msg.message || ''; // dev-authored graphic — safe, same as TV panel
  } else if (style === 'ascii_art' || style === 'credits') {
    const pre = document.createElement('pre');
    pre.className = 'mediadeck-preview-ascii';
    pre.textContent = msg.message || '';
    el.appendChild(pre);
  } else {
    if (style === 'ticker') el.classList.add('mediadeck-preview-ticker');
    el.textContent = msg.message || '';
  }
  preview.appendChild(el);
  // spacer between lines
  const sp = document.createElement('div');
  sp.style.height = '0.4em';
  preview.appendChild(sp);
  // trim old lines
  while (preview.children.length > MAX_PREVIEW_LINES * 2) {
    preview.removeChild(preview.firstChild);
  }
  preview.scrollTop = preview.scrollHeight;
}

// On-screen overlay/graphics, mirroring the TV panel's applyTvOverlay (see
// panels/tv.js) but scaled into the small preview window. Music is deliberately
// NOT mirrored here — only visual overlays. A null overlay clears (clear_overlay).
export function applyMediaDeckOverlay(overlay) {
  _clearOverlay();
  const container = document.getElementById('mediadeck-overlay-container');
  if (!container || !overlay) return;
  // An on-screen graphic is live content — clear any dead-air card.
  _setNoBroadcast(false);

  let el;
  if (overlay.overlayType === 'text_card') {
    el = document.createElement('div');
    el.className = 'mediadeck-overlay-text-card';
    el.innerHTML = escapeHtml(overlay.text).replace(/\n/g, '<br>');
  } else if (overlay.overlayType === 'lower_third') {
    el = document.createElement('div');
    el.className = 'mediadeck-overlay-lower-third';
    el.innerHTML =
      `<div class="mediadeck-overlay-lt-name">${escapeHtml(overlay.text)}</div>` +
      (overlay.subtext ? `<div class="mediadeck-overlay-lt-sub">${escapeHtml(overlay.subtext)}</div>` : '');
  } else if (overlay.overlayType === 'alert_flash') {
    el = document.createElement('div');
    el.className = 'mediadeck-overlay-alert';
    el.innerHTML =
      `<div class="mediadeck-overlay-alert-title">${escapeHtml(overlay.text)}</div>` +
      (overlay.subtext ? `<div class="mediadeck-overlay-alert-sub">${escapeHtml(overlay.subtext)}</div>` : '');
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
  const container = document.getElementById('mediadeck-overlay-container');
  if (container) container.innerHTML = '';
}

function formatTime(secondsSinceMidnight) {
  const h = Math.floor(secondsSinceMidnight / 3600) % 24;
  const m = Math.floor((secondsSinceMidnight % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function renderMediaDeckPanel(data) {
  const { deckName, channelName, channelNumber, lightState, channelType, activeCassetteId, cassettes, schedule } = data;

  document.getElementById('mediadeck-name').textContent = deckName || 'Media Deck';
  document.getElementById('mediadeck-channel').textContent = channelName
    ? `Ch ${channelNumber ?? '—'}: ${channelName}`
    : 'Not linked to a channel';

  const lightEl = document.getElementById('mediadeck-light');
  lightEl.className = 'mediadeck-light mediadeck-light-' + (lightState || 'red');
  document.getElementById('mediadeck-light-label').textContent = _lightLabel(lightState, activeCassetteId);

  const previewHeader = document.getElementById('mediadeck-preview-header');
  if (previewHeader) {
    if (!data.channelId || lightState === 'red') {
      previewHeader.textContent = '— NO SIGNAL —';
      previewHeader.className = 'mediadeck-preview-header mediadeck-preview-header-offline';
    } else if (lightState === 'green') {
      previewHeader.textContent = '⬤ LIVE';
      previewHeader.className = 'mediadeck-preview-header mediadeck-preview-header-live';
    } else {
      previewHeader.textContent = '● ON AIR';
      previewHeader.className = 'mediadeck-preview-header mediadeck-preview-header-scripted';
    }
  }

  // A deck with no channel link or in an offline state is authoritatively dead
  // air — raise the card immediately (live channels clear it when a line lands).
  if (!data.channelId || lightState === 'red') _setNoBroadcast(true);

  const activeCassette = (cassettes || []).find(c => c.id === activeCassetteId);
  const cartridgeEl = document.getElementById('mediadeck-cartridge');
  const slotEl = document.getElementById('mediadeck-slot');
  const isPlaying = lightState === 'orange';
  // Keep the idle whir in sync with power state (idempotent), and give a capstan
  // spin-up swell the moment a tape actually starts rolling.
  _setDeckWhir(lightState !== 'red');
  if (isPlaying && !_wasPlaying) window.AudioEngine?.playSfx(MEDIADECK_SPINUP_DEF);
  _wasPlaying = isPlaying;
  document.getElementById('mediadeck-reel-l')?.classList.toggle('spinning', isPlaying);
  document.getElementById('mediadeck-reel-r')?.classList.toggle('spinning', isPlaying);
  const labelStrip = document.getElementById('mediadeck-cassette-label-strip');
  if (activeCassette) {
    slotEl.classList.add('loaded');
    cartridgeEl.innerHTML = `<span class="mediadeck-cartridge-label">${escapeHtml(activeCassette.name)}</span>`;
    if (labelStrip) labelStrip.textContent = activeCassette.name;
  } else {
    slotEl.classList.remove('loaded');
    cartridgeEl.innerHTML = '<span class="mediadeck-cartridge-label">— EMPTY —</span>';
    if (labelStrip) labelStrip.textContent = '';
  }

  const listEl = document.getElementById('mediadeck-cassette-list');
  listEl.innerHTML = '';
  if (!cassettes || !cassettes.length) {
    listEl.innerHTML = '<div class="mediadeck-empty">— NO TRACKS LOADED —</div>';
  } else {
    cassettes.forEach((c, i) => {
      const isActive = c.id === activeCassetteId;
      const row = document.createElement('div');
      row.className = 'mediadeck-cassette-row' + (isActive ? ' active' : '');
      row.innerHTML = `<span class="mediadeck-track-num">${String(i + 1).padStart(2, '0')}</span>
        <span class="mediadeck-cassette-spool${isActive ? ' spinning' : ''}"></span>
        <span class="mediadeck-cassette-name">${escapeHtml(c.name)}</span>
        <span class="mediadeck-cassette-cat">${escapeHtml(c.category || '')}</span>
        ${isActive ? '<span class="mediadeck-playing-tag">▶ PLAY</span>' : ''}`;
      row.addEventListener('click', () => {
        _deckClick();
        sendCmdSilent(`selectcassette ${c.id}`);
      });
      listEl.appendChild(row);
    });
  }

  const schedEl = document.getElementById('mediadeck-schedule-list');
  schedEl.innerHTML = '';
  if (!schedule || !schedule.length) {
    schedEl.innerHTML = '<div class="mediadeck-empty">— NO SCHEDULE ON FILE —</div>';
  } else {
    for (const s of schedule) {
      const row = document.createElement('div');
      row.className = 'mediadeck-schedule-row';
      row.innerHTML = `<span class="mediadeck-schedule-time">${formatTime(s.startTime)}</span>
        <span class="mediadeck-schedule-name">${escapeHtml(s.name)}</span>`;
      schedEl.appendChild(row);
    }
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Glass swings open, a fresh cassette drops in from the top and seats, then the
// glass closes over it.
function _insertCassette() {
  const slot = document.getElementById('mediadeck-slot');
  if (!slot) return;
  slot.classList.remove('ejecting');
  slot.classList.add('deck-opening', 'inserting');
  setTimeout(() => slot.classList.remove('inserting', 'deck-opening'), 850);
}

// The reverse: glass opens and the seated cassette rises up and out, then the
// glass closes on the empty slot.
function _ejectCassette() {
  const slot = document.getElementById('mediadeck-slot');
  if (!slot) return;
  slot.classList.remove('inserting');
  slot.classList.add('deck-opening', 'ejecting');
  setTimeout(() => slot.classList.remove('ejecting', 'deck-opening'), 700);
}

function showLoadPicker() {
  const picker = document.getElementById('mediadeck-load-picker');
  const list = document.getElementById('mediadeck-load-picker-list');
  const cassettes = deckData?.inventoryCassettes || [];
  list.innerHTML = '';
  if (!cassettes.length) {
    list.innerHTML = '<div class="mediadeck-load-picker-empty">— NO CASSETTES IN INVENTORY —</div>';
  } else {
    cassettes.forEach(c => {
      const row = document.createElement('div');
      row.className = 'mediadeck-load-picker-item';
      row.textContent = c.name;
      row.addEventListener('click', () => {
        _deckClick();
        window.AudioEngine?.playSfx(MEDIADECK_INSERT_DEF);
        _insertCassette();
        sendCmdSilent(`load cassette ${c.name}`);
        hideLoadPicker();
      });
      list.appendChild(row);
    });
  }
  picker.hidden = false;
}

function hideLoadPicker() {
  document.getElementById('mediadeck-load-picker').hidden = true;
}

export function initMediaDeckPanel() {
  document.getElementById('mediadeck-close').addEventListener('click', closeMediaDeckPanel);
  document.getElementById('mediadeck-panel').addEventListener('click', e => {
    if (e.target.id === 'mediadeck-panel') closeMediaDeckPanel();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && deckData) {
      if (!document.getElementById('mediadeck-load-picker').hidden) {
        hideLoadPicker();
      } else {
        closeMediaDeckPanel();
      }
    }
  });
  document.getElementById('mediadeck-eject-btn').addEventListener('click', () => {
    _deckClick();
    if (deckData?.activeCassetteId) {
      window.AudioEngine?.playSfx(MEDIADECK_EJECT_DEF);
      _ejectCassette();
    }
    // Note: the whir keeps running through the press — it only stops on close
    // or when the server reports the deck powered down (handled in render).
    sendCmdSilent('eject');
  });
  document.getElementById('mediadeck-load-btn').addEventListener('click', () => { _deckClick(); showLoadPicker(); });
  document.getElementById('mediadeck-load-picker-cancel').addEventListener('click', () => { _deckClick(); hideLoadPicker(); });
  document.getElementById('mediadeck-restart-btn').addEventListener('click', () => {
    _deckClick();
    sendCmdSilent('_restartbroadcast');
  });

  _makeDeckDraggable();
}

// Drag the deck around by its header — mirrors the AMP player's drag handling.
function _makeDeckDraggable() {
  const box = document.getElementById('mediadeck-box');
  const handle = document.getElementById('mediadeck-header');
  if (!box || !handle) return;
  handle.style.cursor = 'grab';
  let dragging = false, ox = 0, oy = 0;
  handle.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    dragging = true;
    const r = box.getBoundingClientRect();
    ox = e.clientX - r.left;
    oy = e.clientY - r.top;
    // Break out of the panel's flex-centering so left/top take effect.
    box.style.position = 'fixed';
    box.style.margin = '0';
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    handle.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    box.style.left = `${Math.max(0, e.clientX - ox)}px`;
    box.style.top  = `${Math.max(0, e.clientY - oy)}px`;
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.style.cursor = 'grab';
  });
}

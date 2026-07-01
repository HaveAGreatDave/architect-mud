import { sendCmdSilent, sendRaw } from '../net.js';

let deckData = null;
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
const MEDIADECK_WHIR_DEF = {
  id: 'mediadeck_whir_local', category: 'tv', priority: 1, loop: true,
  config: { waveform: 'triangle', freq: 180, gain: 0.12, noiseMix: 0.2,
    filter: { type: 'lowpass', freq: 900, q: 1 },
    tremolo: { rate: 4, depth: 0.3 },
    adsr: { a: 0.3, d: 0.1, s: 1, r: 0.3 } },
};

const MEDIADECK_EJECT_DEF = {
  id: 'mediadeck_eject_local', category: 'tv', priority: 4,
  config: { layers: [
    { waveform: 'noise', noiseMix: 1, duration: 0.08, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 }, filter: { type: 'highpass', freq: 1500, q: 1 } },
    { waveform: 'triangle', freq: 150, duration: 0.3, gain: 0.5, pitchBend: { to: 60, time: 0.25 }, adsr: { a: 0.001, d: 0.15, s: 0.2, r: 0.15 }, filter: { type: 'lowpass', freq: 700, q: 1 } },
  ] },
};

// The reverse gesture: a slide-in friction noise then a low clunk as the tape
// locks into place (vs. eject's noise-burst + downward pitch drop).
const MEDIADECK_INSERT_DEF = {
  id: 'mediadeck_insert_local', category: 'tv', priority: 4,
  config: { layers: [
    { waveform: 'noise', noiseMix: 1, duration: 0.12, adsr: { a: 0.01, d: 0.08, s: 0, r: 0.04 }, filter: { type: 'bandpass', freq: 1800, q: 1 } },
    { waveform: 'triangle', freq: 90, duration: 0.15, gain: 0.6, adsr: { a: 0.001, d: 0.1, s: 0, r: 0.06 }, filter: { type: 'lowpass', freq: 600, q: 1 } },
  ] },
};

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
  _setDeckWhir(data.lightState === 'orange');
  // Clear preview on open and subscribe to channel broadcast
  const previewMsgs = document.getElementById('mediadeck-preview-msgs');
  if (previewMsgs) previewMsgs.innerHTML = '';
  if (data.channelId) sendRaw({ type: 'deck_watch', channelId: data.channelId });
}

export function closeMediaDeckPanel() {
  sendRaw({ type: 'deck_unwatch' });
  document.getElementById('mediadeck-panel').classList.remove('active');
  document.getElementById('mediadeck-load-picker').hidden = true;
  deckData = null;
  _setDeckWhir(false);
}

export function updateMediaDeckBroadcast(msg) {
  const preview = document.getElementById('mediadeck-preview-msgs');
  if (!preview) return;
  const el = document.createElement('div');
  el.className = 'mediadeck-preview-line';
  el.textContent = msg.message || '';
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

  const activeCassette = (cassettes || []).find(c => c.id === activeCassetteId);
  const cartridgeEl = document.getElementById('mediadeck-cartridge');
  const slotEl = document.getElementById('mediadeck-slot');
  const isPlaying = lightState === 'orange';
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
    if (deckData?.activeCassetteId) {
      window.AudioEngine?.playSfx(MEDIADECK_EJECT_DEF);
      _ejectCassette();
    }
    _setDeckWhir(false);
    sendCmdSilent('eject');
  });
  document.getElementById('mediadeck-load-btn').addEventListener('click', showLoadPicker);
  document.getElementById('mediadeck-load-picker-cancel').addEventListener('click', hideLoadPicker);
  document.getElementById('mediadeck-restart-btn').addEventListener('click', () => {
    sendCmdSilent('_restartbroadcast');
  });
}

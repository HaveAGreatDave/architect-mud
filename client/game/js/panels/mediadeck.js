import { sendCmdSilent } from '../net.js';

let deckData = null;

const LIGHT_LABEL = { green: 'LIVE — NO TAPE', orange: 'PLAYING TAPE', red: 'OFFLINE' };

export function openMediaDeckPanel(data) {
  deckData = data;
  renderMediaDeckPanel(data);
  document.getElementById('mediadeck-panel').classList.add('active');
}

export function closeMediaDeckPanel() {
  document.getElementById('mediadeck-panel').classList.remove('active');
  deckData = null;
}

function formatTime(secondsSinceMidnight) {
  const h = Math.floor(secondsSinceMidnight / 3600) % 24;
  const m = Math.floor((secondsSinceMidnight % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function renderMediaDeckPanel(data) {
  const { deckName, channelName, channelNumber, lightState, activeCassetteId, cassettes, schedule } = data;

  document.getElementById('mediadeck-name').textContent = deckName || 'Media Deck';
  document.getElementById('mediadeck-channel').textContent = channelName
    ? `Ch ${channelNumber ?? '—'}: ${channelName}`
    : 'Not linked to a channel';

  const lightEl = document.getElementById('mediadeck-light');
  lightEl.className = 'mediadeck-light mediadeck-light-' + (lightState || 'red');
  document.getElementById('mediadeck-light-label').textContent = LIGHT_LABEL[lightState] || 'OFFLINE';

  const listEl = document.getElementById('mediadeck-cassette-list');
  listEl.innerHTML = '';
  if (!cassettes || !cassettes.length) {
    listEl.innerHTML = '<div class="mediadeck-empty">No cassettes in this deck.</div>';
  } else {
    for (const c of cassettes) {
      const row = document.createElement('div');
      row.className = 'mediadeck-cassette-row' + (c.id === activeCassetteId ? ' active' : '');
      row.innerHTML = `<span class="mediadeck-cassette-name">${escapeHtml(c.name)}</span>
        <span class="mediadeck-cassette-cat">${escapeHtml(c.category || '')}</span>`;
      row.addEventListener('click', () => {
        sendCmdSilent(`selectcassette ${c.id}`);
      });
      listEl.appendChild(row);
    }
  }

  const schedEl = document.getElementById('mediadeck-schedule-list');
  schedEl.innerHTML = '';
  if (!schedule || !schedule.length) {
    schedEl.innerHTML = '<div class="mediadeck-empty">No schedule on file.</div>';
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

export function initMediaDeckPanel() {
  document.getElementById('mediadeck-close').addEventListener('click', closeMediaDeckPanel);
  document.getElementById('mediadeck-panel').addEventListener('click', e => {
    if (e.target.id === 'mediadeck-panel') closeMediaDeckPanel();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && deckData) closeMediaDeckPanel();
  });
  document.getElementById('mediadeck-eject-btn').addEventListener('click', () => {
    sendCmdSilent('eject');
    closeMediaDeckPanel();
  });
}

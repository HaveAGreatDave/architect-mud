import { state } from '../state.js';
import { openWhisperTab } from './whisper.js';

// Sidebar "Online" roster. A first-class .sidebar-section, so the sidebar-order
// engine already gives it a drag-resize handle and a scrolling body — this just
// keeps the list fresh and renders it.

const POLL_MS = 12000;
let _players = [];
let _timer = null;

async function refresh() {
  if (!state.player) return; // not logged in yet
  try {
    const r = await fetch('/api/players/online');
    const data = await r.json();
    _players = Array.isArray(data) ? data : [];
  } catch { /* keep last known list on a blip */ }
  render();
}

function render() {
  const list = document.getElementById('players-online-list');
  if (!list) return;
  const countEl = document.getElementById('players-online-count');
  if (countEl) countEl.textContent = _players.length ? `(${_players.length})` : '';

  if (!_players.length) {
    list.innerHTML = '<div class="players-online-empty">No one online.</div>';
    return;
  }
  const myHandle = document.getElementById('handle-display')?.textContent?.trim();
  const sorted = [..._players].sort((a, b) => a.handle.localeCompare(b.handle));
  list.innerHTML = sorted.map(p => {
    const isSelf = p.handle === myHandle;
    const safe = p.handle.replace(/"/g, '&quot;');
    const whisper = isSelf ? '' : `<button class="players-online-whisper" data-whisper="${safe}" title="Whisper ${safe}">✉</button>`;
    return `<div class="players-online-row">
      <div class="players-online-who">
        <span class="players-online-handle${isSelf ? ' is-self' : ''}">${p.handle}${isSelf ? ' (you)' : ''}</span>
        <span class="players-online-zone">${p.current_zone || ''}</span>
      </div>
      ${whisper}
    </div>`;
  }).join('');

  list.querySelectorAll('[data-whisper]').forEach(btn => {
    btn.addEventListener('click', () => openWhisperTab(btn.dataset.whisper));
  });
}

export function initPlayersPanel() {
  if (_timer) return;
  refresh();
  _timer = setInterval(refresh, POLL_MS);
}

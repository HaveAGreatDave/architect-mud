// Architect Music Player (AMP) — local Walkman UI for personal music playback.
// Opened by typing `music` in the command bar (intercepted client-side in
// input.js — never sent to server). Fetches the song library from /audio/songs
// + /audio/instruments directly and drives window.AudioEngine locally.

let _songs = [];
let _instruments = {};   // id -> row
let _currentIdx = -1;
let _playing = false;

// ── Library fetch ─────────────────────────────────────────────────────────────

async function _loadLibrary() {
  try {
    const [sr, ir] = await Promise.all([
      fetch('/audio/songs'),
      fetch('/audio/instruments'),
    ]);
    const [songsData, instsData] = await Promise.all([sr.json(), ir.json()]);
    _songs = Array.isArray(songsData) ? songsData : [];
    _instruments = {};
    if (Array.isArray(instsData)) for (const i of instsData) _instruments[i.id] = i;
  } catch {
    _songs = [];
    _instruments = {};
  }
}

function _resolveSong(song) {
  const _instrumentsById = {};
  for (const id of (song.instrument_ids || []))
    if (_instruments[id]) _instrumentsById[id] = _instruments[id];
  return { ...song, _instrumentsById };
}

// ── Playback ──────────────────────────────────────────────────────────────────

function _playIdx(idx) {
  if (idx < 0 || idx >= _songs.length) return;
  _currentIdx = idx;
  _playing = true;
  window.AudioEngine?.init();
  window.AudioEngine?.playMusic(_resolveSong(_songs[idx]));
  _updateDisplay();
}

function _stop() {
  _playing = false;
  window.AudioEngine?.stopMusic();
  _updateDisplay();
}

// ── Display ───────────────────────────────────────────────────────────────────

function _updateDisplay() {
  const song = _songs[_currentIdx];
  const panel = document.getElementById('musicplayer-panel');

  const trackEl = document.getElementById('amp-lcd-track');
  const statusEl = document.getElementById('amp-lcd-status');
  const playBtn  = document.getElementById('amp-play');

  if (trackEl)  trackEl.textContent  = song
    ? song.name.replace(/_/g, ' ').toUpperCase()
    : 'NO TRACK LOADED';
  if (statusEl) statusEl.textContent = _playing
    ? `▶  PLAYING   [${String(_currentIdx + 1).padStart(2, '0')}]   ${song?.tempo || '--'} BPM`
    : '■  STOPPED';
  if (playBtn)  playBtn.textContent  = _playing ? '⏸' : '▶';

  panel?.querySelectorAll('.amp-reel').forEach(r =>
    r.classList.toggle('spinning', _playing));
  panel?.querySelectorAll('.amp-track-row').forEach((row, i) =>
    row.classList.toggle('current', i === _currentIdx));
}

function _renderTrackList() {
  const list = document.getElementById('amp-tracklist');
  if (!list) return;
  if (!_songs.length) {
    list.innerHTML = '<div class="amp-no-tracks">NO TRACKS FOUND</div>';
    return;
  }
  list.innerHTML = _songs.map((s, i) => `
    <div class="amp-track-row${i === _currentIdx ? ' current' : ''}" data-idx="${i}">
      <span class="amp-track-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="amp-track-name">${s.name.replace(/_/g, ' ').toUpperCase()}</span>
      <span class="amp-track-bpm">${s.tempo} BPM</span>
    </div>`).join('');
  list.querySelectorAll('.amp-track-row').forEach(row =>
    row.addEventListener('click', () => _playIdx(parseInt(row.dataset.idx))));
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function openMusicPlayerPanel() {
  const panel = document.getElementById('musicplayer-panel');
  // Toggle: if already open, close it
  if (panel.classList.contains('active')) { closeMusicPlayerPanel(); return; }
  await _loadLibrary();
  panel.classList.add('active');
  _renderTrackList();
  _updateDisplay();
}

export function closeMusicPlayerPanel() {
  document.getElementById('musicplayer-panel').classList.remove('active');
}

// ── Init (call once on page load) ─────────────────────────────────────────────

export function initMusicPlayerPanel() {
  const panel = document.getElementById('musicplayer-panel');

  document.getElementById('amp-close').addEventListener('click', closeMusicPlayerPanel);
  panel.addEventListener('click', e => { if (e.target === panel) closeMusicPlayerPanel(); });

  document.getElementById('amp-play').addEventListener('click', () => {
    if (_playing) _stop();
    else if (_songs.length) _playIdx(_currentIdx < 0 ? 0 : _currentIdx);
  });
  document.getElementById('amp-stop').addEventListener('click', _stop);
  document.getElementById('amp-prev').addEventListener('click', () => {
    if (!_songs.length) return;
    _playIdx((_currentIdx - 1 + _songs.length) % _songs.length);
  });
  document.getElementById('amp-next').addEventListener('click', () => {
    if (!_songs.length) return;
    _playIdx((_currentIdx + 1) % _songs.length);
  });

  // TRACKS drawer toggle
  const trackBtn = document.getElementById('amp-tracks-btn');
  const trackList = document.getElementById('amp-tracklist');
  trackBtn.addEventListener('click', () => {
    const open = trackList.classList.toggle('open');
    trackBtn.textContent = open ? 'TRACKS ▲' : 'TRACKS ▼';
  });

  // Draggable via header
  const header = document.getElementById('amp-header');
  let dragging = false, ox = 0, oy = 0;
  header.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    dragging = true;
    const r = panel.getBoundingClientRect();
    ox = e.clientX - r.left;
    oy = e.clientY - r.top;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    panel.style.left  = `${Math.max(0, e.clientX - ox)}px`;
    panel.style.top   = `${Math.max(0, e.clientY - oy)}px`;
    panel.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => { dragging = false; });
}

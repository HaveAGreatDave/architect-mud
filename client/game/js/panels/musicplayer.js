// Architect Music Player (AMP) — local Walkman UI for personal music playback.
// Opened by typing `music` in the command bar (intercepted client-side in
// input.js — never sent to server). Fetches the song library from
// /api/audio/songs + /api/audio/instruments directly and drives
// window.AudioEngine locally.

let _songs = [];
let _localSongs = [];    // .MOD tapes imported from the player's machine this session
let _instruments = {};   // id -> row
let _samples = {};       // id -> sample metadata row
let _currentIdx = -1;
let _playing = false;
let _loaded = false;     // a cassette is physically seated in the deck
// Bumped on every transport action; async animation steps bail if it changed,
// so rapid Next/Prev/Eject clicks can't stack overlapping playback.
let _seq = 0;

// ── Deck SFX (synthesized, routed through the SFX bus like poker-sfx.js) ───────
// The mechanical foley around loading a tape: the glass door motor + latch, the
// cassette seating "thunk", the slide-out on eject, the capstan spin-up as a song
// starts, and a transport blip for Next/Prev.
const SFX = {
  // Servo whirr of the lid motor, capped by the latch click as the glass opens.
  door: { id: 'amp-door', category: 'sfx', priority: 7, config: { duration: 0.42, layers: [
    { waveform: 'sawtooth', freq: 68, filter: { type: 'lowpass', freq: 560, q: 3 },
      vibrato: { rate: 24, depth: 14 }, adsr: { a: 0.04, d: 0.05, s: 0.6, r: 0.14 }, gain: 0.13 },
    { waveform: 'triangle', freq: 2100, delay: 0.27, adsr: { a: 0.001, d: 0.03, s: 0, r: 0.02 }, gain: 0.16 },
    { waveform: 'noise', delay: 0.27, filter: { type: 'highpass', freq: 4200, q: 0.7 },
      adsr: { a: 0.001, d: 0.02, s: 0, r: 0.015 }, gain: 0.11 },
  ] } },
  // Dull "clunk" as the cassette seats home: a fast pitch drop reads as a body-
  // thud (not a note), with filtered noise carrying the plastic knock. No held
  // tone — the melodic mid-layer is gone so it lands flat and mechanical.
  thunk: { id: 'amp-thunk', category: 'sfx', priority: 7, config: { duration: 0.2, layers: [
    { waveform: 'sine', freq: 100, pitchBend: { to: 38, time: 0.04 },
      adsr: { a: 0.001, d: 0.1, s: 0, r: 0.04 }, gain: 0.55 },
    { waveform: 'noise', filter: { type: 'lowpass', freq: 700, q: 1.2 },
      adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 }, gain: 0.42 },
  ] } },
  // Tape sliding back out of the slot, ending on the spring-loaded latch pop.
  slide: { id: 'amp-slide', category: 'sfx', priority: 7, config: { duration: 0.5, layers: [
    { waveform: 'noise', filter: { type: 'bandpass', freq: 1700, q: 0.8 },
      adsr: { a: 0.03, d: 0.34, s: 0.15, r: 0.14 }, gain: 0.2 },
    { waveform: 'triangle', freq: 480, delay: 0.3, pitchBend: { to: 260, time: 0.08 },
      adsr: { a: 0.001, d: 0.07, s: 0, r: 0.04 }, gain: 0.22 },
  ] } },
  // Steady "whirrrrrr" of the capstan as the reels engage and a song begins.
  // A held low motor tone with vibrato flutter (no rising pitch glide, so it
  // reads as a running motor rather than a musical whoop) plus reel hiss on top.
  spin: { id: 'amp-spin', category: 'sfx', priority: 7, config: { duration: 0.6, layers: [
    { waveform: 'sawtooth', freq: 80, filter: { type: 'lowpass', freq: 620, q: 2 },
      vibrato: { rate: 26, depth: 12 }, adsr: { a: 0.08, d: 0.06, s: 0.75, r: 0.2 }, gain: 0.1 },
    { waveform: 'noise', filter: { type: 'bandpass', freq: 1400, q: 0.9 },
      adsr: { a: 0.08, d: 0.1, s: 0.5, r: 0.2 }, gain: 0.07 },
  ] } },
  // Short transport blip for Next / Prev.
  blip: { id: 'amp-blip', category: 'sfx', priority: 7, config: { duration: 0.08, layers: [
    { waveform: 'square', freq: 860, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.02 }, gain: 0.15 },
  ] } },
};
function _sfx(def) { window.AudioEngine?.playSfx(def); }

// Choreography timings (ms). The insert drop is slowed a touch and music holds
// until the tape has fully seated, the glass has closed, and the capstan whirs.
const T_EJECT   = 640;   // slide-out + glass swing (matches amp-cassette-rise CSS)
const T_SEAT    = 820;   // cassette lands home mid-drop → thunk
const T_LABEL   = 380;   // update reels/label mid-drop so it reads as the new tape
const T_INSERT  = 1050;  // drop finishes, glass closes (matches amp-cassette-drop CSS)
const T_REELS   = 1000;  // beat after the glass closes before the capstan whirs and the reels break inertia
const T_ENGAGE  = 260;   // reels spin up, then the play key depresses and the music engages

// ── Library fetch ─────────────────────────────────────────────────────────────

async function _loadLibrary() {
  try {
    const [sr, ir, smr] = await Promise.all([
      fetch('/api/audio/songs'),
      fetch('/api/audio/instruments'),
      fetch('/api/audio/samples'),
    ]);
    const [songsData, instsData, samplesData] = await Promise.all([sr.json(), ir.json(), smr.json()]);
    // AMP is a personal-music Walkman: only surface songs filed under the 'misc'
    // category (the others — ui/combat/cyberpunk/environment/tv — are engine cues,
    // not listenable tracks).
    _songs = Array.isArray(songsData)
      ? songsData.filter(s => Array.isArray(s.channels) && s.channels.length > 0 && s.category === 'misc')
      : [];
    // Keep any locally-imported tapes appended after the fetched library so they
    // survive closing/reopening the panel (they're gone only on a full page reload).
    _songs.push(..._localSongs);
    _instruments = {};
    if (Array.isArray(instsData)) for (const i of instsData) _instruments[i.id] = i;
    _samples = {};
    if (Array.isArray(samplesData)) for (const s of samplesData) _samples[s.id] = s;
  } catch {
    _songs = [];
    _instruments = {};
    _samples = {};
  }
}

// ── Local .MOD import (personal jukebox) ───────────────────────────────────────
// Load a .MOD chosen from the player's own machine, parse it in the browser (no
// server round-trip, nothing stored), append it to the playlist and play it. These
// personal tapes live for the session only — re-import after a reload. They can't
// be shared in-game; players pass the raw .MOD files around themselves.
async function _importLocalMod(file) {
  if (!file) return;
  const statusEl = document.getElementById('amp-lcd-status');
  if (!window.ModParser) { if (statusEl) statusEl.textContent = '⚠  IMPORT UNAVAILABLE'; return; }
  if (statusEl) statusEl.textContent = '…  READING TAPE';
  try {
    const buf = await file.arrayBuffer();
    const { song } = window.ModParser.parseModToLocalSong(buf, file.name);
    _localSongs.push(song);
    _songs.push(song);
    _renderTrackList();
    _playIdx(_songs.length - 1);   // drop the new tape in and play it
  } catch (e) {
    if (statusEl) statusEl.textContent = '⚠  NOT A VALID .MOD';
  }
}

// Attach each sample-backed instrument's `_sampleDef` so the song player uses the
// actual sample instead of a synth waveform (mirrors the server's
// resolveSongInstruments in plugins/audio/index.js).
function _resolveSong(song) {
  // Locally-imported tapes (Load .MOD) already carry their resolved instruments
  // with inlined sample data — nothing to look up in the DB library.
  if (song._local) return song;
  const _instrumentsById = {};
  for (const id of (song.instrument_ids || [])) {
    const inst = _instruments[id];
    if (!inst) continue;
    const copy = { ...inst };
    if (inst.sample_id && _samples[inst.sample_id]) copy._sampleDef = _samples[inst.sample_id];
    _instrumentsById[id] = copy;
  }
  return { ...song, _instrumentsById };
}

// ── Playback ──────────────────────────────────────────────────────────────────

// Load a track and play it, with the full mechanical choreography: if a tape is
// already seated it slides out first, then the glass opens, the new cassette
// drops in and thunks home, the glass closes, the capstan whirs, and only then
// does the music start (music waits for the animation to finish).
function _playIdx(idx) {
  if (idx < 0 || idx >= _songs.length) return;
  window.AudioEngine?.init();
  const win = document.getElementById('amp-cassette-window');
  const token = ++_seq;
  _currentIdx = idx;

  const insert = () => {
    if (token !== _seq || !win) { if (token === _seq) _startPlayback(token); return; }
    win.classList.remove('ejecting');
    win.classList.add('deck-opening', 'inserting');
    _sfx(SFX.door);
    setTimeout(() => { if (token === _seq) _sfx(SFX.thunk); }, T_SEAT);
    setTimeout(() => { if (token === _seq) { _loaded = true; _updateDisplay(); } }, T_LABEL);
    setTimeout(() => {
      if (token !== _seq) return;
      win.classList.remove('inserting', 'deck-opening');
      _startPlayback(token);
    }, T_INSERT);
  };

  if (win && _loaded) {
    // Eject the seated tape first, then insert the new one (door stays open).
    window.AudioEngine?.stopMusic();
    _playing = false;
    _updateButtons();
    win.classList.remove('inserting', 'deck-opening');
    win.classList.add('ejecting');
    _sfx(SFX.slide);
    setTimeout(() => {
      if (token !== _seq) return;
      win.classList.remove('ejecting');
      insert();
    }, T_EJECT);
  } else {
    insert();
  }
}

// Spin up the capstan and start the already-seated tape. Shared by _playIdx (end
// of the insert animation) and Play-from-stopped (tape already in the deck).
// After `reelDelay`, the capstan whirs and the reels break inertia; a moment
// later the play key depresses and the music engages.
function _startPlayback(token, reelDelay = T_REELS) {
  if (token !== _seq) return;
  const panel = document.getElementById('musicplayer-panel');
  setTimeout(() => {
    if (token !== _seq) return;
    _sfx(SFX.spin);
    panel?.querySelectorAll('.amp-reel').forEach(r => r.classList.add('spinning'));
  }, reelDelay);
  setTimeout(() => {
    if (token !== _seq) return;
    _loaded = true;
    _playing = true;
    window.AudioEngine?.playMusic(_resolveSong(_songs[_currentIdx]));
    _updateDisplay();
  }, reelDelay + T_ENGAGE);
}

function _stop() {
  _seq++;               // cancel any in-flight insert/eject animation
  _playing = false;
  // Settle the deck: close the glass and clear any half-run drop/rise so a Stop
  // mid-animation doesn't leave the door hanging open.
  document.getElementById('amp-cassette-window')
    ?.classList.remove('inserting', 'deck-opening', 'ejecting');
  window.AudioEngine?.stopMusic();
  _updateDisplay();
}

// Eject the current cassette: stop, slide the tape out, and leave the deck empty.
function _eject() {
  const win = document.getElementById('amp-cassette-window');
  const token = ++_seq;
  window.AudioEngine?.stopMusic();
  _playing = false;
  _updateButtons();
  const finish = () => { _currentIdx = -1; _loaded = false; _updateDisplay(); };
  if (win && _loaded) {
    win.classList.remove('inserting', 'deck-opening');
    win.classList.add('ejecting');
    _sfx(SFX.slide);
    setTimeout(() => {
      if (token !== _seq) return;
      win.classList.remove('ejecting');
      finish();
    }, T_EJECT);
  } else {
    finish();
  }
}

// ── Display ───────────────────────────────────────────────────────────────────

// Light the transport buttons in the accent colour to reflect state: Play glows
// while playing, Stop glows while stopped, and the Play glyph toggles ⏸ / ▶.
function _updateButtons() {
  const playBtn = document.getElementById('amp-play');
  const stopBtn = document.getElementById('amp-stop');
  playBtn?.classList.toggle('active', _playing);
  stopBtn?.classList.toggle('active', !_playing);
  if (playBtn) playBtn.textContent = _playing ? '⏸' : '▶';
}

// Brief accent-colour pulse on a transport button (Next / Prev feedback).
function _flashBtn(id) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.classList.remove('blip');
  void btn.offsetWidth;   // restart the animation if clicked in quick succession
  btn.classList.add('blip');
  setTimeout(() => btn.classList.remove('blip'), 200);
}

function _updateDisplay() {
  const song = _songs[_currentIdx];
  const panel = document.getElementById('musicplayer-panel');

  const trackEl = document.getElementById('amp-lcd-track');
  const statusEl = document.getElementById('amp-lcd-status');

  if (trackEl)  trackEl.textContent  = song
    ? song.name.replace(/_/g, ' ').toUpperCase()
    : 'NO TRACK LOADED';
  if (statusEl) statusEl.textContent = _playing
    ? `▶  PLAYING   [${String(_currentIdx + 1).padStart(2, '0')}]   ${song?.tempo || '--'} BPM`
    : '■  STOPPED';
  _updateButtons();

  panel?.querySelectorAll('.amp-reel').forEach(r =>
    r.classList.toggle('spinning', _playing));
  panel?.querySelectorAll('.amp-track-row').forEach((row, i) =>
    row.classList.toggle('current', i === _currentIdx));
  const cassetteBody = document.getElementById('amp-cassette-body');
  const cassetteLabel = document.getElementById('amp-cassette-label-strip');
  if (cassetteBody) cassetteBody.classList.toggle('loaded', _currentIdx >= 0);
  if (cassetteLabel && song) cassetteLabel.textContent = song.name.replace(/_/g, ' ').toUpperCase();
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

export function stopMusicPlayer() {
  _stop();
  closeMusicPlayerPanel();
}

// ── Init (call once on page load) ─────────────────────────────────────────────

export function initMusicPlayerPanel() {
  const panel = document.getElementById('musicplayer-panel');

  document.getElementById('amp-close').addEventListener('click', closeMusicPlayerPanel);
  panel.addEventListener('click', e => { if (e.target === panel) closeMusicPlayerPanel(); });

  document.getElementById('amp-play').addEventListener('click', () => {
    if (_playing) { _stop(); return; }
    if (!_songs.length) return;
    // Tape already seated → just spin it back up (short capstan lead-in, no full
    // insertion beat); otherwise load one from scratch.
    if (_loaded && _currentIdx >= 0) _startPlayback(++_seq, 220);
    else _playIdx(_currentIdx < 0 ? 0 : _currentIdx);
  });
  document.getElementById('amp-stop').addEventListener('click', _stop);
  document.getElementById('amp-eject').addEventListener('click', _eject);
  document.getElementById('amp-prev').addEventListener('click', () => {
    if (!_songs.length) return;
    _sfx(SFX.blip);
    _flashBtn('amp-prev');
    _playIdx((_currentIdx - 1 + _songs.length) % _songs.length);
  });
  document.getElementById('amp-next').addEventListener('click', () => {
    if (!_songs.length) return;
    _sfx(SFX.blip);
    _flashBtn('amp-next');
    _playIdx((_currentIdx + 1) % _songs.length);
  });

  // LOAD .MOD — pick a module off the player's own machine and play it locally.
  const loadBtn = document.getElementById('amp-load-btn');
  const loadFile = document.getElementById('amp-load-file');
  loadBtn?.addEventListener('click', () => loadFile?.click());
  loadFile?.addEventListener('change', () => {
    const file = loadFile.files[0];
    _importLocalMod(file);
    loadFile.value = '';   // reset so re-picking the same file fires 'change' again
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

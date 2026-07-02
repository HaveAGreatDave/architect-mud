// Datachip Replay Deck — plays back surveillance footage stored on a datachip.
// Aesthetic: a chunky 80s VHS cassette deck fused with a cyberdeck — spinning
// reels, amber timecode, VHS tracking distortion, evidence stickers.

let clip = null;
let idx = 0;
let playing = false;
let timer = null;
let audioCtx = null;

const FRAME_MS = 850;      // playback pace
const FRAME_SECS = 5;      // capture cadence (matches the server tick) → timecode

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function thunk(freq = 90, dur = 0.12, type = 'square', gain = 0.05) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = gain;
    o.connect(g); g.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur);
  } catch { /* no audio; playback still works */ }
}

function frameCount() { return clip?.frames?.length || 0; }

function timecode(i) {
  const s = i * FRAME_SECS;
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function fmtDate(sec) {
  if (!sec) return '--·--·--';
  const d = new Date(sec * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}·${p(d.getDate())}·${String(d.getFullYear()).slice(2)}  ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function openDatachipReplay(msg) {
  clip = msg.clip;
  idx = 0;
  render();
  document.getElementById('chip-panel').classList.add('active');
  thunk(70, 0.16);                         // deck-load clunk
  setTimeout(() => play(), 250);
}

export function closeDatachipReplay() {
  pause();
  document.getElementById('chip-panel').classList.remove('active');
  clip = null;
  thunk(60, 0.14);                         // eject clunk
}

function play() {
  if (!clip || playing) return;
  if (idx >= frameCount() - 1) idx = 0;    // replay from top if at end
  playing = true;
  timer = setInterval(step, FRAME_MS);
  render();
}

function pause() {
  playing = false;
  if (timer) { clearInterval(timer); timer = null; }
  render();
}

function step() {
  if (idx >= frameCount() - 1) { pause(); return; }
  idx++;
  render();
}

function seek(to) {
  idx = Math.max(0, Math.min(frameCount() - 1, to));
  render();
}

function render() {
  if (!clip) return;
  const n = frameCount();
  document.getElementById('chip-zone').textContent = clip.zone || 'UNKNOWN';
  document.getElementById('chip-date').textContent = fmtDate(clip.capturedAt);

  const ev = document.getElementById('chip-evidence');
  if (clip.crimeTags?.length) { ev.style.display = ''; ev.textContent = `⚠ EVIDENCE · ${clip.crimeTags.join(' · ').toUpperCase()}`; }
  else ev.style.display = 'none';

  const atEnd = idx >= n - 1;
  const f = clip.frames[idx];
  document.getElementById('chip-screen-text').textContent = n ? (f?.text || '') : 'NO FOOTAGE';
  document.getElementById('chip-tc').textContent = `SP  ${timecode(idx)}`;
  document.getElementById('chip-counter').textContent = `${String(Math.min(idx + 1, n)).padStart(3, '0')} / ${String(n).padStart(3, '0')}`;
  document.getElementById('chip-mode').textContent = playing ? '▶ PLAY' : (atEnd ? '■ END' : '❚❚ PAUSE');

  const scrub = document.getElementById('chip-scrub');
  scrub.max = Math.max(0, n - 1);
  scrub.value = idx;

  document.getElementById('chip-box').classList.toggle('chip-playing', playing);
  document.getElementById('chip-playpause').textContent = playing ? '❚❚' : '▶';
}

export function initDatachipReplay() {
  document.getElementById('chip-close').addEventListener('click', closeDatachipReplay);
  document.getElementById('chip-panel').addEventListener('click', e => {
    if (e.target.id === 'chip-panel') closeDatachipReplay();
  });
  document.addEventListener('keydown', e => {
    if (!clip) return;
    if (e.key === 'Escape') closeDatachipReplay();
    else if (e.key === ' ') { e.preventDefault(); playing ? pause() : play(); }
    else if (e.key === 'ArrowRight') { pause(); seek(idx + 1); }
    else if (e.key === 'ArrowLeft') { pause(); seek(idx - 1); }
  });
  document.getElementById('chip-playpause').addEventListener('click', () => { playing ? pause() : play(); thunk(320, 0.05); });
  document.getElementById('chip-rew').addEventListener('click', () => { pause(); seek(0); thunk(200, 0.05); });
  document.getElementById('chip-ff').addEventListener('click', () => { pause(); seek(frameCount() - 1); thunk(200, 0.05); });
  document.getElementById('chip-prev').addEventListener('click', () => { pause(); seek(idx - 1); });
  document.getElementById('chip-next').addEventListener('click', () => { pause(); seek(idx + 1); });
  document.getElementById('chip-scrub').addEventListener('input', e => { pause(); seek(parseInt(e.target.value, 10) || 0); });
}

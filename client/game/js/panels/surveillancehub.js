import { sendCmdSilent } from '../net.js';

// SPECTER Surveillance Hub — multi-feed monitor. Opened by `hub` / `use <deck>`;
// the server pushes `surveillance_hub` (open) and `surveillance_hub_update` (live
// frames every 5s while open). We re-render on each push, preserving focus.

let hubData = null;
let focusId = null;
let prevStatus = {};   // id -> last status, for offline-transition SFX
let lastAlertKey = null;
let audioCtx = null;

const STATUS_LABEL = { offline: 'NO SIGNAL', damaged: 'DAMAGED', jammed: 'JAMMED', spoofed: 'SIGNAL FAULT' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Tiny self-contained blips (no dependency on the game audio engine).
function blip(freq, dur, type = 'square', gain = 0.04) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g); g.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur);
  } catch { /* audio not available; feeds still render */ }
}

export function openSurveillanceHub(data) {
  hubData = data;
  if (!focusId && data.tiles?.length) focusId = data.tiles[0].id;
  prevStatus = {};
  const top = data.alerts?.[0];
  lastAlertKey = top ? `${top.t}|${top.text}` : null;   // don't chirp existing alerts on open
  render();
  document.getElementById('shub-panel').classList.add('active');
  blip(680, 0.08); setTimeout(() => blip(920, 0.09), 90); // power-up chirp
}

export function updateSurveillanceHub(data) {
  const panel = document.getElementById('shub-panel');
  if (!hubData || !panel.classList.contains('active')) return;
  // Buzz when a feed drops since last frame.
  for (const t of data.tiles || []) {
    if (prevStatus[t.id] === 'ok' && t.status !== 'ok') blip(140, 0.18, 'sawtooth', 0.05);
  }
  // Chirp on a fresh sensor alert.
  const topAlert = data.alerts?.[0];
  const key = topAlert ? `${topAlert.t}|${topAlert.text}` : null;
  if (key && key !== lastAlertKey) { blip(1040, 0.07); setTimeout(() => blip(1320, 0.08), 80); }
  lastAlertKey = key;
  hubData = data;
  if (focusId && !data.tiles.some(t => t.id === focusId)) focusId = data.tiles[0]?.id || null;
  render();
}

export function closeSurveillanceHub() {
  document.getElementById('shub-panel').classList.remove('active');
  hubData = null;
  sendCmdSilent('hubclose');
}

function tileFeedHtml(t) {
  if (t.status === 'ok') return `<div class="shub-feed-txt">${esc(t.frame || '')}</div>`;
  const label = STATUS_LABEL[t.status] || 'NO SIGNAL';
  return `<div class="shub-feed-static shub-static-${esc(t.status)}"><span>${label}</span></div>`;
}

function render() {
  if (!hubData) return;
  const box = document.getElementById('shub-box');
  box.style.setProperty('--shub-accent', hubData.net?.color || '#39ff9e');
  document.getElementById('shub-netname').textContent = hubData.net?.name || 'SPECTER';

  const tiles = hubData.tiles || [];
  document.getElementById('shub-count').textContent = `${tiles.filter(t => t.status === 'ok').length}/${tiles.length} LIVE`;

  const alerts = hubData.alerts || [];
  document.getElementById('shub-alerts').innerHTML = alerts.length
    ? `<div class="shub-alerts-hd">◉ ALERTS</div>` +
      alerts.map(a => `<div class="shub-alert"><span class="shub-alert-t">${esc(a.t)}</span> ${esc(a.text)}</div>`).join('')
    : '';

  const grid = document.getElementById('shub-grid');
  if (!tiles.length) {
    grid.innerHTML = `<div class="shub-empty">No deployed devices.<br><span class="shub-dim">Plant a cam, then check back.</span></div>`;
    document.getElementById('shub-focus').innerHTML = '';
    tiles.forEach(t => prevStatus[t.id] = t.status);
    return;
  }

  grid.innerHTML = tiles.map(t => {
    const rec = t.recording ? '<span class="shub-rec">●REC</span>' : '';
    const sig = t.status === 'ok' ? '<span class="shub-sig shub-sig-ok">▮▮▮</span>' : '<span class="shub-sig shub-sig-dead">▯▯▯</span>';
    return `
      <div class="shub-tile shub-${esc(t.status)}${t.id === focusId ? ' shub-focused' : ''}" data-id="${esc(t.id)}">
        <div class="shub-tile-head"><span class="shub-tile-name">${esc(t.name)}</span><span class="shub-kind">${esc(t.kind)}·T${esc(t.tier || 1)}</span></div>
        <div class="shub-feed">${tileFeedHtml(t)}<div class="shub-scan"></div></div>
        <div class="shub-tile-foot">
          <span class="shub-zone">${esc(t.zone || '?')}</span>
          <span class="shub-meta">${sig} 🔋${esc(t.battery)} ${rec}</span>
        </div>
      </div>`;
  }).join('');

  const focus = tiles.find(t => t.id === focusId) || tiles[0];
  document.getElementById('shub-focus').innerHTML = focus ? `
    <div class="shub-focus-head">
      <span class="shub-focus-name">▸ ${esc(focus.name)}</span>
      <span class="shub-focus-meta">${esc(focus.zone || '?')} · ${esc(focus.ts || '')} · 🔋${esc(focus.battery)}${focus.recording ? ' · <span class="shub-rec">●REC</span>' : ''}</span>
    </div>
    <div class="shub-focus-feed shub-${esc(focus.status)}">${tileFeedHtml(focus)}<div class="shub-scan"></div></div>
    <div class="shub-ctrls">
      <button class="shub-btn${focus.recording ? ' shub-btn-on' : ''}" data-act="record" data-id="${esc(focus.id)}">${focus.recording ? '■ STOP REC' : '● RECORD'}</button>
      <button class="shub-btn" data-act="clip" data-id="${esc(focus.id)}">▤ CLIP → REEL</button>
      <button class="shub-btn" data-act="clear" data-id="${esc(focus.id)}">✕ CLEAR</button>
    </div>` : '';

  grid.querySelectorAll('.shub-tile').forEach(el => el.addEventListener('click', () => {
    focusId = el.dataset.id;
    blip(520, 0.05);
    render();
  }));

  document.querySelectorAll('#shub-focus [data-act]').forEach(el => el.addEventListener('click', () => {
    const id = el.dataset.id;
    if (el.dataset.act === 'record') { sendCmdSilent(`record ${id}`); blip(760, 0.06); }
    else if (el.dataset.act === 'clip') { sendCmdSilent(`clip ${id}`); blip(440, 0.05); setTimeout(() => blip(660, 0.07), 70); }
    else if (el.dataset.act === 'clear') { sendCmdSilent(`wipe ${id}`); blip(300, 0.05); }
  }));

  tiles.forEach(t => prevStatus[t.id] = t.status);
}

export function initSurveillanceHub() {
  document.getElementById('shub-close').addEventListener('click', closeSurveillanceHub);
  document.getElementById('shub-panel').addEventListener('click', e => {
    if (e.target.id === 'shub-panel') closeSurveillanceHub();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && hubData) closeSurveillanceHub();
  });
}

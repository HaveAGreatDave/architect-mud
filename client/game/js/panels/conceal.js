// Conceal scan-sweep — the reactive palm minigame when you're searched during an
// arrest (server fires type:'conceal_search'). Your open contraband sits in a row;
// a scanner line sweeps across. Tap an item BEFORE the line reaches it to palm it
// (you can hold up to maxPalm); tap AFTER and you're caught mid-reach (a botch —
// contraband-possession charge). Anything you don't touch is scanned openly and
// seized. On finish, replies `concealresolve <nonce> <palmedIds> <botchedIds>`.

import { sendCmdSilent } from '../net.js';

const TRACK_W = 460, CHIP_W = 66;
let _el = null, _raf = 0, _done = false, _lineX = 0;
let _chips = [], _palmed = [], _botched = [], _nonce = '', _maxPalm = 1;

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function cleanup() {
  if (_raf) { cancelAnimationFrame(_raf); _raf = 0; }
  document.removeEventListener('keydown', onKey);
  _el?.remove(); _el = null;
}

function finish() {
  if (_done) return;
  _done = true;
  sendCmdSilent(`concealresolve ${_nonce} ${_palmed.join(',')} ${_botched.join(',')}`);
  cleanup();
}

// Decide a chip when the player reaches for it: clean palm before the line, caught
// after it, ignored once no room / already decided.
function tryPalm(c) {
  if (_done || c.decided) return;
  if (_lineX >= c.centerX) {                 // line already scanned it — caught mid-reach
    c.decided = 'botch'; _botched.push(c.id);
    c.el.classList.add('conceal-botch'); c.el.querySelector('.conceal-tag').textContent = 'CAUGHT';
    return;
  }
  if (_palmed.length >= _maxPalm) {          // hands full
    c.el.classList.add('conceal-full');
    setTimeout(() => c.el.classList.remove('conceal-full'), 220);
    return;
  }
  c.decided = 'palm'; _palmed.push(c.id);
  c.el.classList.add('conceal-palmed'); c.el.querySelector('.conceal-tag').textContent = 'PALMED';
}

function onKey(e) {
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= _chips.length) { e.preventDefault(); tryPalm(_chips[n - 1]); }
}

// msg: { nonce, scanMs, maxPalm, items:[{id,name,glyph}] }
export function openConcealSearch(msg) {
  cleanup();
  _done = false; _lineX = 0; _palmed = []; _botched = []; _chips = [];
  _nonce = msg.nonce || '';
  const items = Array.isArray(msg.items) ? msg.items.slice(0, 6) : [];
  _maxPalm = Math.max(1, Math.min(items.length, Number(msg.maxPalm) || 1));
  const scanMs = Math.max(1200, Number(msg.scanMs) || 3000);
  if (!items.length) { finish(); return; }   // nothing to palm — just resolve

  const el = document.createElement('div');
  el.className = 'conceal-window';
  el.innerHTML = `
    <div class="conceal-title">⛓ PAT-DOWN — PALM WHAT YOU CAN</div>
    <div class="conceal-sub">You can hide <b>${_maxPalm}</b>. Tap before the scan line reaches it. <span class="conceal-keys">[1–${items.length}]</span></div>
    <div class="conceal-track" style="width:${TRACK_W}px">
      <div class="conceal-line"></div>
    </div>`;
  document.body.appendChild(el);
  _el = el;

  const track = el.querySelector('.conceal-track');
  const spacing = TRACK_W / (items.length + 1);
  items.forEach((it, i) => {
    const centerX = spacing * (i + 1);
    const chip = document.createElement('div');
    chip.className = 'conceal-chip';
    chip.style.left = `${centerX - CHIP_W / 2}px`;
    chip.innerHTML = `<div class="conceal-glyph">${esc(it.glyph || '✦')}</div>` +
      `<div class="conceal-name">${esc(it.name || 'item')}</div>` +
      `<div class="conceal-tag">${i + 1}</div>`;
    track.appendChild(chip);
    const c = { id: it.id, centerX, el: chip, decided: null };
    chip.addEventListener('click', () => tryPalm(c));
    _chips.push(c);
  });
  document.addEventListener('keydown', onKey);

  const line = el.querySelector('.conceal-line');
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / scanMs);
    _lineX = t * TRACK_W;
    line.style.left = `${_lineX}px`;
    for (const c of _chips) {
      if (!c.decided && _lineX >= c.centerX) { c.decided = 'scan'; c.el.classList.add('conceal-scanned'); }
    }
    if (t < 1) _raf = requestAnimationFrame(frame);
    else finish();
  }
  _raf = requestAnimationFrame(frame);
}

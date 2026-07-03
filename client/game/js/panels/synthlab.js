// SYNTH LAB — the "stabilize the reaction" cooking minigame.
//
// A reaction level bobs in a vessel: it falls under gravity and rises while you
// apply heat (hold mouse / space). A drifting SAFE BAND narrows with recipe
// difficulty. Your score = fraction of time you kept the level inside the band.
//
// Launched by the `synth_minigame` server message (see dispatch.js). On finish,
// opts.onResult({score}) fires `synthresolve <recipeId> <score>`; the server
// rolls the authoritative chemistry check and folds this 0–100 score into the
// margin (better cook → higher potency). Aborting (Esc) does NOT resolve — the
// cook is simply abandoned, reagents intact.

import { sfx } from './minigame-common.js';

let _overlay = null, _raf = null, _keyDown = null, _keyUp = null, _opts = null, _st = null;

function ensureStyles() {
  if (document.getElementById('synth-lab-styles')) return;
  const s = document.createElement('style');
  s.id = 'synth-lab-styles';
  s.textContent = `
  #synth-lab-overlay { position:fixed; inset:0; z-index:9996; display:flex; align-items:center; justify-content:center;
    background:rgba(2,6,4,0.78); backdrop-filter:blur(2px); font-family:var(--font-mono,monospace); }
  #synth-lab-overlay .sl-panel { background:#0a120c; border:1px solid #1c3a24; border-radius:4px; padding:16px 18px;
    box-shadow:0 0 40px rgba(40,220,120,0.15); width:320px; }
  #synth-lab-overlay .sl-title { color:#4fe08a; letter-spacing:2px; font-size:13px; margin-bottom:2px; }
  #synth-lab-overlay .sl-sub { color:#6f8f7a; font-size:10px; text-transform:uppercase; letter-spacing:1px; margin-bottom:10px; }
  #synth-lab-overlay canvas { display:block; margin:0 auto; background:#050a07; border:1px solid #143020; border-radius:3px; }
  #synth-lab-overlay .sl-hud { display:flex; justify-content:space-between; color:#9fc7ac; font-size:11px; margin-top:8px; }
  #synth-lab-overlay .sl-hint { color:#5f7f6a; font-size:10px; text-align:center; margin-top:8px; }
  #synth-lab-overlay .sl-result { color:#7fffb0; text-align:center; font-size:15px; margin-top:8px; min-height:18px; }
  `;
  document.head.appendChild(s);
}

export function openSynthMinigame(opts = {}) {
  ensureStyles();
  close();
  _opts = { difficulty: 5, recipeName: 'COMPOUND', workspace: '', hard: false, onResult: null, ...opts };
  const hard = _opts.hard;
  const diff = Math.max(1, Math.min(hard ? 16 : 10, _opts.difficulty));

  const overlay = document.createElement('div');
  overlay.id = 'synth-lab-overlay';
  overlay.innerHTML = `
    <div class="sl-panel">
      <div class="sl-title">⚗ SYNTHESIS // ${String(_opts.recipeName).toUpperCase()}</div>
      <div class="sl-sub">stabilize the reaction${_opts.workspace ? ' · ' + _opts.workspace : ''}</div>
      <canvas id="synth-canvas" width="288" height="300"></canvas>
      <div class="sl-hud"><span id="sl-time">14.0s</span><span id="sl-stab">STABILITY 0%</span></div>
      <div class="sl-result" id="sl-result"></div>
      <div class="sl-hint">HOLD mouse / SPACE to apply heat — keep the level in the green band. Esc aborts.</div>
    </div>`;
  document.body.appendChild(overlay);
  _overlay = overlay;

  const canvas = overlay.querySelector('#synth-canvas');
  const ctx = canvas.getContext('2d');

  _st = {
    ctx, w: canvas.width, h: canvas.height,
    level: 0.5, vel: 0, holding: false,
    t: 0, dur: hard ? 16 : 14, inBand: 0, last: performance.now(),
    // difficulty tuning (harder splice mode = narrower, faster-drifting band)
    gravity: (hard ? 1.1 : 0.95) + diff * 0.04,
    push: (hard ? 2.05 : 1.9) + diff * 0.05,
    bandHalf: Math.max(hard ? 0.045 : 0.06, (hard ? 0.14 : 0.17) - diff * (hard ? 0.007 : 0.009)),
    bandSpeed: (hard ? 0.26 : 0.18) + diff * (hard ? 0.05 : 0.045),
    over: false,
  };

  const setHold = (v) => { if (_st) _st.holding = v; };
  overlay.addEventListener('mousedown', (e) => { if (e.button === 0) setHold(true); });
  window.addEventListener('mouseup', () => setHold(false));
  _keyDown = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); setHold(true); }
  };
  _keyUp = (e) => { if (e.code === 'Space' || e.key === ' ') setHold(false); };
  window.addEventListener('keydown', _keyDown);
  window.addEventListener('keyup', _keyUp);

  _raf = requestAnimationFrame(loop);
}

function bandCenter(st) {
  const c = 0.5 + (0.5 - st.bandHalf) * 0.8 * Math.sin(st.t * st.bandSpeed * Math.PI * 2);
  return Math.max(st.bandHalf, Math.min(1 - st.bandHalf, c));
}

function loop(now) {
  const st = _st;
  if (!st || st.over) return;
  let dt = (now - st.last) / 1000;
  st.last = now;
  if (dt > 0.1) dt = 0.1; // clamp big frame gaps

  // Physics: heat pushes up, gravity pulls down, with inertia + damping.
  st.vel += (st.holding ? st.push : -st.gravity) * dt;
  st.vel *= Math.pow(0.06, dt); // heavy damping so it settles, not floaty
  st.level += st.vel * dt;
  if (st.level <= 0) { st.level = 0; st.vel = 0; }
  if (st.level >= 1) { st.level = 1; st.vel = 0; }

  st.t += dt;
  const center = bandCenter(st);
  const inBand = Math.abs(st.level - center) <= st.bandHalf;
  if (inBand) st.inBand += dt;

  render(st, center, inBand);

  const left = Math.max(0, st.dur - st.t);
  _overlay.querySelector('#sl-time').textContent = left.toFixed(1) + 's';
  _overlay.querySelector('#sl-stab').textContent = 'STABILITY ' + Math.round((st.inBand / Math.max(0.001, st.t)) * 100) + '%';

  if (st.t >= st.dur) return finish();
  _raf = requestAnimationFrame(loop);
}

function render(st, center, inBand) {
  const { ctx, w, h } = st;
  ctx.clearRect(0, 0, w, h);
  const vx = w / 2 - 34, vw = 68, vy = 14, vh = h - 28;
  const toY = (lvl) => vy + (1 - lvl) * vh;

  // vessel
  ctx.strokeStyle = '#1c3a24'; ctx.lineWidth = 2;
  ctx.strokeRect(vx, vy, vw, vh);

  // safe band
  const bTop = toY(center + st.bandHalf), bBot = toY(center - st.bandHalf);
  ctx.fillStyle = inBand ? 'rgba(60,230,130,0.22)' : 'rgba(60,230,130,0.10)';
  ctx.fillRect(vx + 1, bTop, vw - 2, bBot - bTop);
  ctx.strokeStyle = 'rgba(80,240,150,0.6)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(vx, bTop); ctx.lineTo(vx + vw, bTop);
  ctx.moveTo(vx, bBot); ctx.lineTo(vx + vw, bBot); ctx.stroke();

  // fluid fill up to level
  const ly = toY(st.level);
  const col = inBand ? ['#1f7a48', '#4fe08a'] : (st.level > center ? ['#7a5a1f', '#e0b64f'] : ['#7a2a1f', '#e0644f']);
  const grad = ctx.createLinearGradient(0, ly, 0, vy + vh);
  grad.addColorStop(0, col[1]); grad.addColorStop(1, col[0]);
  ctx.fillStyle = grad;
  ctx.fillRect(vx + 2, ly, vw - 4, vy + vh - ly);

  // level line + glow
  ctx.strokeStyle = col[1]; ctx.lineWidth = 2;
  ctx.shadowColor = col[1]; ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.moveTo(vx, ly); ctx.lineTo(vx + vw, ly); ctx.stroke();
  ctx.shadowBlur = 0;

  // bubbles when heating
  if (st.holding) {
    ctx.fillStyle = 'rgba(200,255,220,0.5)';
    for (let i = 0; i < 4; i++) {
      const bxr = vx + 6 + Math.random() * (vw - 12);
      const byr = ly + Math.random() * (vy + vh - ly);
      ctx.beginPath(); ctx.arc(bxr, byr, 1.5, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function finish() {
  const st = _st;
  st.over = true;
  const score = Math.max(0, Math.min(100, Math.round((st.inBand / st.dur) * 100)));
  const resEl = _overlay?.querySelector('#sl-result');
  if (resEl) {
    const verdict = score >= 75 ? 'CLEAN COOK' : score >= 45 ? 'PASSABLE' : 'MESSY';
    resEl.textContent = `${verdict} — ${score}% stable`;
  }
  const cb = _opts?.onResult;
  sfx({ priority: 6, config: { duration: 0.4, layers: [
    { waveform: 'sine', freq: score >= 60 ? 520 : 200, pitchBend: { to: score >= 60 ? 780 : 120, time: 0.3 }, adsr: { a: 0.01, d: 0.3, s: 0.2, r: 0.1 }, gain: 0.14 } ] } });
  setTimeout(() => { close(); if (cb) cb({ score }); }, 950);
}

function close() {
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  if (_keyDown) { window.removeEventListener('keydown', _keyDown); _keyDown = null; }
  if (_keyUp) { window.removeEventListener('keyup', _keyUp); _keyUp = null; }
  if (_overlay) { _overlay.remove(); _overlay = null; }
  _st = null;
}

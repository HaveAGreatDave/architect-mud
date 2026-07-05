// SYNTH LAB — the COOK game: make the initial drugs. A cook menu opens at the
// station (pick a batch), then a SINGLE-STAGE minigame runs, chosen by the drug's
// FORM → family, then a QUENCH tap sets it. Four families, each simple:
//   WET       (liquid/gel/paste) — stabilize the reaction (hold to heat, keep in band)
//   SOLIDS    (powder/pill/crystal) — press to the right force ×3 (hold, release in band)
//   GAS       (gas) — regulate pressure (TAP to vent, keep the needle in the green)
//   BOTANICAL (leaf/blotter) — cure gently (hold, wide forgiving band)
// Difficulty (band width, danger) scales with the drug's cook_tier + your skill,
// server-side. On finish, opts.onResult({score}) → `synthresolve <recipeId> <score>`.

import { sendCmd } from '../net.js';
import { clamp, rnd, shade, G, W, H, roundRect, drawBench, drawBeaker, drawBurner, fillLiquid, drawSteam, AX, mountLab } from './lab-kit.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── COOK MENU (pick a batch at the station) ──────────────────────────────────
let _menu = null;
function ensureMenuStyles() {
  if (document.getElementById('cook-menu-styles')) return;
  const s = document.createElement('style'); s.id = 'cook-menu-styles';
  s.textContent = `
  #cook-menu-overlay{position:fixed;inset:0;z-index:9996;display:flex;align-items:center;justify-content:center;background:rgba(2,6,4,.86);backdrop-filter:blur(3px);font-family:var(--font-mono,monospace)}
  #cook-menu-overlay .cm-panel{width:min(560px,94vw);max-height:86vh;display:flex;flex-direction:column;background:linear-gradient(180deg,#0e1512,#070b09);border:1px solid rgba(79,224,138,.35);border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,.85)}
  #cook-menu-overlay .cm-head{padding:12px 16px;border-bottom:1px solid rgba(79,224,138,.2);color:#4fe08a;letter-spacing:2px;font-size:13px;display:flex;justify-content:space-between;align-items:center}
  #cook-menu-overlay .cm-head b{text-shadow:1px 0 #ff4a5b,-1px 0 #5fd0e0}
  #cook-menu-overlay .cm-close{cursor:pointer;color:#8496a8}
  #cook-menu-overlay .cm-close:hover{color:#ff4a5b}
  #cook-menu-overlay .cm-list{overflow-y:auto;padding:8px}
  #cook-menu-overlay .cm-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border:1px solid #143020;border-radius:5px;margin-bottom:7px;background:#0a140d;cursor:pointer}
  #cook-menu-overlay .cm-row:hover{border-color:#4fe08a;background:#0c1a11}
  #cook-menu-overlay .cm-row.locked{opacity:.5;cursor:not-allowed}
  #cook-menu-overlay .cm-nm{flex:1;color:#cfe9d8;font-size:13px}
  #cook-menu-overlay .cm-fam{font-size:8px;letter-spacing:1px;text-transform:uppercase;padding:2px 6px;border-radius:3px;border:1px solid rgba(120,150,140,.3);color:#9fc7ac}
  #cook-menu-overlay .cm-tier{display:flex;gap:2px}
  #cook-menu-overlay .cm-tier i{width:6px;height:12px;border-radius:1px;background:#243029}
  #cook-menu-overlay .cm-tier i.on{background:linear-gradient(#4fe08a,#ffb23e)}
  #cook-menu-overlay .cm-val{color:#e0b64f;font-size:11px;min-width:52px;text-align:right}
  #cook-menu-overlay .cm-need{font-size:9px;color:#e0644f;margin-top:2px}
  #cook-menu-overlay .cm-foot{padding:8px 16px;border-top:1px solid rgba(79,224,138,.15);font-size:9px;color:#6f8a7c;line-height:1.5}`;
  document.head.appendChild(s);
}
export function openCookMenu(msg) {
  ensureMenuStyles(); closeCookMenu();
  const items = msg.items || [];
  const overlay = document.createElement('div'); overlay.id = 'cook-menu-overlay';
  const rows = items.map((it, i) => {
    const bars = Array.from({ length: 5 }, (_, k) => `<i class="${k < it.tier ? 'on' : ''}"></i>`).join('');
    const locked = !it.ready;
    return `<div class="cm-row ${locked ? 'locked' : ''}" data-i="${i}">
      <span class="cm-nm">${esc(it.drug)}${locked ? `<div class="cm-need">needs ${(it.need || []).map(esc).join(', ')}</div>` : ''}</span>
      <span class="cm-fam">${esc(it.family)}</span>
      <span class="cm-tier" title="intensity tier ${it.tier}">${bars}</span>
      <span class="cm-val">${it.value}₵</span>
    </div>`;
  }).join('') || '<div style="padding:22px;text-align:center;color:#6f8a7c">You know no cooks yet.</div>';
  overlay.innerHTML = `<div class="cm-panel">
    <div class="cm-head"><span>⚗ <b>COOK</b> — pick a batch</span><span class="cm-close" title="close">✕</span></div>
    <div class="cm-list">${rows}</div>
    <div class="cm-foot">${msg.hasLab ? 'chem lab detected — full potency.' : 'no chem lab here — a cook kit works at a penalty.'}<br>tier = intensity · harder drugs are pricier and dangerous to botch.</div>
  </div>`;
  document.body.appendChild(overlay); _menu = overlay;
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeCookMenu(); });
  overlay.querySelector('.cm-close').addEventListener('click', closeCookMenu);
  overlay.querySelectorAll('.cm-row').forEach(row => row.addEventListener('click', () => {
    const it = items[+row.dataset.i]; if (!it || !it.ready) return; AX.click(); sendCmd('cook ' + it.recipe); closeCookMenu();
  }));
  window.addEventListener('keydown', _menuKey);
}
function _menuKey(e) { if (e.key === 'Escape') closeCookMenu(); }
export function closeCookMenu() { window.removeEventListener('keydown', _menuKey); if (_menu) { _menu.remove(); _menu = null; } }

// ── COOK MINIGAME ────────────────────────────────────────────────────────────
let _g = null;

// shared "keep a level in a drifting band" engine (WET + BOTANICAL)
function bandInit(g, o) { g.level = .5; g.vel = 0; g.hold = false; g.inBand = 0; g.heatS = 0; g.bubbles = []; g.dur = o.dur; g.gravity = o.gravity; g.push = o.push; g.bandHalf = o.bandHalf; g.bandSpeed = o.bandSpeed; }
function bandCenter(g) { const c = .5 + (.5 - g.bandHalf) * .5 * Math.sin(g.t * g.bandSpeed * Math.PI * 2); return clamp(c, g.bandHalf, 1 - g.bandHalf); }
function bandUpdate(g, dt, onDone) {
  g.vel += (g.hold ? g.push : -g.gravity) * dt; g.vel *= Math.pow(.06, dt); g.level = clamp(g.level + g.vel * dt, 0, 1);
  g.heatS += ((g.hold ? 1 : 0) - g.heatS) * Math.min(1, dt * 6); AX.loopGain('burner', .03 + g.heatS * .1);
  const c = bandCenter(g), inb = Math.abs(g.level - c) <= g.bandHalf; if (inb) g.inBand += dt;
  if (Math.random() < g.heatS * .6 + .05) g.bubbles.push({ x: rnd(1, -1), y: 0, r: rnd(3, 1), spd: rnd(1.4, .6) });
  g.bubbles.forEach(b => b.y += b.spd * dt); g.bubbles = g.bubbles.filter(b => b.y < 1);
  if (g.t >= g.dur) { g.workScore = clamp(g.inBand / g.dur, 0, 1); onDone(); }
}

const FAMILIES = {
  wet: {
    accent: '#4fe08a', label: 'STABILIZE — hold to heat, keep it in the green band',
    init(g) { bandInit(g, { dur: 14, gravity: 0.9 + g.difficulty * .04, push: 1.7 + g.difficulty * .04, bandHalf: clamp(.18 - g.difficulty * .007, .07, .18), bandSpeed: .12 + g.difficulty * .02 }); AX.loop('burner', { freq: 70, type: 'sawtooth', gain: .04, filt: 520, tremRate: 11, tremDepth: .35 }); },
    update(g, dt) { bandUpdate(g, dt, () => toQuench(g, 'quench and set the batch')); },
    input(g, down) { g.hold = down; },
    draw(g) { drawBandGame(g, { burner: true, steam: true, okCol: '#4fe08a', stat: (x) => `STABLE ${Math.round(x.inBand / Math.max(.001, x.t) * 100)}% · ${Math.max(0, x.dur - x.t).toFixed(1)}s` }); },
    exit() { AX.stop('burner'); },
  },
  botanical: {
    accent: '#7fbf5a', label: 'CURE — gentle warmth, hold it in the wide green band',
    init(g) { bandInit(g, { dur: 14, gravity: 0.55, push: 1.15, bandHalf: clamp(.26 - g.difficulty * .006, .15, .26), bandSpeed: .06 + g.difficulty * .01 }); AX.loop('burner', { freq: 58, type: 'sine', gain: .025, filt: 380, tremRate: 5, tremDepth: .2 }); },
    update(g, dt) { bandUpdate(g, dt, () => toQuench(g, 'press and jar it')); },
    input(g, down) { g.hold = down; },
    draw(g) { drawBandGame(g, { burner: false, steam: false, flecks: true, okCol: '#7fbf5a', stat: (x) => `CURED ${Math.round(x.inBand / Math.max(.001, x.t) * 100)}% · ${Math.max(0, x.dur - x.t).toFixed(1)}s` }); },
    exit() { AX.stop('burner'); },
  },
  solids: {
    accent: '#ffb23e', label: 'PRESS — hold to build force, release in the green (×3)',
    init(g) { g.pressIdx = 0; g.presses = 3; g.force = 0; g.rising = false; g.scores = []; g.target = .6; g.band = clamp(.14 - g.difficulty * .005, .06, .14); g.rate = 0.5 + g.difficulty * .04; },
    update(g, dt) { if (g.rising) { g.force += dt * g.rate; if (g.force >= 1.08) this.lock(g, true); } },
    lock(g, over) { g.rising = false; const acc = over ? 0 : clamp(1 - Math.abs(g.force - g.target) / (g.band * 2.4), 0, 1); g.scores.push(acc); g.pressIdx++; g.force = 0;
      if (over) AX.bad(); else if (acc > .85) AX.perfect(); else if (acc > .5) AX.good(); else AX.click();
      if (g.pressIdx >= g.presses) { g.workScore = g.scores.reduce((a, b) => a + b, 0) / g.scores.length; toQuench(g, 'seal the tablets'); } },
    input(g, down) { if (down) { if (!g.rising && g.pressIdx < g.presses) g.rising = true; } else if (g.rising) this.lock(g, false); },
    draw(g) { drawSolidsGame(g); },
    exit() { },
  },
  gas: {
    accent: '#5fd0e0', label: 'REGULATE — TAP to vent, keep the needle in the green',
    init(g) { g.pressure = .4; g.inBand = 0; g.dur = 14; g.riseRate = 0.09 + g.difficulty * .018; g.target = .5; g.band = clamp(.16 - g.difficulty * .006, .07, .16); g.vent = 0; AX.loop('hiss', { freq: 180, type: 'sawtooth', gain: .03, filt: 600, tremRate: 14, tremDepth: .4 }); },
    update(g, dt) { g.pressure = clamp(g.pressure + dt * g.riseRate, 0, 1.2); g.vent = Math.max(0, g.vent - dt * 3); AX.loopGain('hiss', .03 + g.pressure * .06);
      if (Math.abs(g.pressure - g.target) <= g.band) g.inBand += dt; if (g.pressure >= 1.12) g.inBand = Math.max(0, g.inBand - dt * 1.5);
      if (g.t >= g.dur) { g.workScore = clamp(g.inBand / g.dur, 0, 1); toQuench(g, 'crack the valve and bottle it'); } },
    input(g, down) { if (down) { g.pressure = clamp(g.pressure - 0.15, 0, 1.2); g.vent = 1; AX.noise(.12, { gain: .1, freq: 2200, type: 'highpass' }); } },
    draw(g) { drawGasGame(g); },
    exit() { AX.stop('hiss'); },
  },
};

export function openSynthMinigame(opts = {}) {
  closeSynth();
  const family = FAMILIES[opts.family] ? opts.family : 'wet';
  const fam = FAMILIES[family];
  const lab = mountLab({ title: 'CHIMERA-9', subtitle: 'COOK · ' + String(opts.recipeName || 'BATCH').toUpperCase(), accent: fam.accent, showInsta: false });
  const d = clamp(opts.difficulty || 5, 1, 14);
  _g = { lab, opts, family, closed: false, phase: 'work', t: 0, last: performance.now(), raf: null, difficulty: d,
    workScore: 0, quenchT: 0, quenchTapped: false, quenchDur: 1.4, result: null, resultT: 0, _resolved: false, _label: fam.label, beaker: { x: W / 2, y: H * 0.48, w: 120, h: 220 } };
  fam.init(_g);
  wireCook(_g);
  _g.lab.ticker(fam.label);
  _g.raf = requestAnimationFrame(cookLoop);
}
function closeSynth() { if (_g && _g.lab) _g.lab.close(); }

function wireCook(g) {
  const canvas = g.lab.canvas;
  const onDown = () => { AX.tick(); if (g.phase === 'work') FAMILIES[g.family].input(g, true); else if (g.phase === 'quench') quenchStrike(g); };
  const onUp = () => { if (g.phase === 'work') FAMILIES[g.family].input(g, false); };
  const onKey = e => { if (e.key === 'Escape') { g.lab.close(); return; } if (e.repeat) return; if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); if (g.phase === 'work') FAMILIES[g.family].input(g, true); else if (g.phase === 'quench') quenchStrike(g); } };
  const onKeyUp = e => { if (e.code === 'Space' || e.key === ' ') { if (g.phase === 'work') FAMILIES[g.family].input(g, false); } };
  canvas.addEventListener('pointerdown', onDown); window.addEventListener('pointerup', onUp); window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKeyUp);
  g.lab.onClose(() => { g.closed = true; canvas.removeEventListener('pointerdown', onDown); window.removeEventListener('pointerup', onUp); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); if (g.raf) cancelAnimationFrame(g.raf); FAMILIES[g.family] && FAMILIES[g.family].exit(g); });
}

function toQuench(g, label) { if (g.phase !== 'work') return; g.phase = 'quench'; g.quenchT = 0; g.quenchTapped = false; FAMILIES[g.family].exit(g); g.lab.ticker(`${label} — strike SPACE as the ring meets the mark.`); }

function cookLoop(now) {
  const g = _g; if (!g || g.closed) return;
  let dt = (now - g.last) / 1000; g.last = now; if (dt > .05) dt = .05;
  if (g.phase === 'work') g.t += dt;
  update(g, dt);
  G.clearRect(0, 0, W, H); drawBench();
  FAMILIES[g.family].draw(g);
  if (g.phase === 'quench') drawQuench(g);
  if (g.phase === 'done') drawDone(g);
  g.raf = requestAnimationFrame(cookLoop);
}
function update(g, dt) {
  if (g.phase === 'work') FAMILIES[g.family].update(g, dt);
  else if (g.phase === 'quench') { g.quenchT += dt; if (g.quenchT > g.quenchDur && !g.quenchTapped) finishCook(g, 'MISS', -0.08); }
  else if (g.phase === 'done') { g.resultT += dt; if (g.resultT > 1.15 && !g._resolved) { g._resolved = true; const cb = g.opts.onResult, score = g.result.score; g.lab.close(); if (cb) cb({ score }); } }
}
function quenchStrike(g) {
  if (g.quenchTapped || g.phase !== 'quench') return; g.quenchTapped = true;
  const R0 = 150, Rt = 34, R = R0 * (1 - clamp(g.quenchT / g.quenchDur, 0, 1)), err = Math.abs(R - Rt), tol = 12 + (16 - g.difficulty);
  if (err < tol * 0.4) { AX.perfect(); g.lab.flash('#4fe08a'); finishCook(g, 'PERFECT', 0.12); }
  else if (err < tol) { AX.good(); finishCook(g, 'GOOD', 0.06); }
  else { AX.click(); finishCook(g, 'OFF', 0); }
}
function finishCook(g, grade, bonus) { if (g.phase === 'done') return; const score = clamp(Math.round((g.workScore + bonus) * 100), 0, 100); g.result = { grade, score }; g.phase = 'done'; g.resultT = 0; AX.tone(score >= 60 ? 520 : 200, .3, { type: 'triangle', gain: .2, to: score >= 60 ? 760 : 120 }); }

// ── shared HUD + finish overlays ─────────────────────────────────────────────
function hud(g, text) { G.save(); G.textAlign = 'center'; G.fillStyle = '#6f8a7c'; G.font = '10px monospace'; G.fillText(g._label || '', W / 2, 50); G.fillStyle = '#cfe9d8'; G.font = 'bold 12px monospace'; G.fillText(text, W / 2, 66); G.restore(); }
function drawQuench(g) {
  const cx = W / 2, cy = H * 0.44, R0 = 150, Rt = 34, R = R0 * (1 - clamp(g.quenchT / g.quenchDur, 0, 1));
  G.strokeStyle = 'rgba(79,224,138,.8)'; G.lineWidth = 3; G.beginPath(); G.arc(cx, cy, Rt, 0, 7); G.stroke();
  if (R > 2 && !g.quenchTapped) { G.strokeStyle = `rgba(95,208,224,${clamp(R / R0 + .2, .3, 1)})`; G.lineWidth = 2.5; G.beginPath(); G.arc(cx, cy, R, 0, 7); G.stroke(); }
  G.fillStyle = '#6f8a7c'; G.font = '9px monospace'; G.textAlign = 'center'; G.fillText('◄ SET ON THE MARK ►', cx, cy - Rt - 12);
}
function drawDone(g) {
  const win = g.result.score >= 60; G.save(); G.textAlign = 'center';
  G.fillStyle = win ? '#4fe08a' : '#e0b64f'; G.font = 'bold 18px monospace'; G.shadowColor = win ? 'rgba(79,224,138,.7)' : 'rgba(224,182,79,.6)'; G.shadowBlur = 14;
  G.fillText(`${g.result.grade} — ${g.result.score}%`, W / 2, H * 0.2); G.shadowBlur = 0;
  G.fillStyle = '#6f8a7c'; G.font = '9px monospace'; G.fillText(g.result.score >= 75 ? 'CLEAN BATCH' : g.result.score >= 45 ? 'PASSABLE' : 'MESSY', W / 2, H * 0.2 + 16); G.restore();
}

// ── per-family renderers ─────────────────────────────────────────────────────
function drawBandGame(g, o) {
  const b = g.beaker, base = b.y + b.h / 2, ly = base - g.level * (b.h * 0.7), slosh = clamp(Math.abs(g.vel) * 0.5, 0, 1);
  if (o.burner) drawBurner(b, g.heatS, g.t);
  drawBeaker(b, () => {
    const c = bandCenter(g), inb = Math.abs(g.level - c) <= g.bandHalf, col = inb ? o.okCol : (g.level > c ? '#e0b64f' : '#e0644f');
    fillLiquid(b.x - b.w / 2, b.w, ly, base, col, col, g.t, slosh, g.heatS);
    const bt = base - (c + g.bandHalf) * (b.h * 0.7), bb = base - (c - g.bandHalf) * (b.h * 0.7);
    G.fillStyle = inb ? 'rgba(90,255,150,.16)' : 'rgba(90,255,150,.07)'; G.fillRect(b.x - b.w / 2, bt, b.w, bb - bt);
    G.strokeStyle = 'rgba(120,255,170,.6)'; G.setLineDash([5, 4]); G.lineWidth = 1; G.beginPath(); G.moveTo(b.x - b.w / 2, bt); G.lineTo(b.x + b.w / 2, bt); G.moveTo(b.x - b.w / 2, bb); G.lineTo(b.x + b.w / 2, bb); G.stroke(); G.setLineDash([]);
    if (o.flecks) for (let i = 0; i < 10; i++) { G.fillStyle = shade(o.okCol, -20); const fx = b.x + Math.sin(g.t * 1.5 + i) * b.w * .3, fy = ly + ((i * 17 + g.t * 10) % Math.max(1, base - ly)); G.save(); G.translate(fx, fy); G.rotate(i); G.fillRect(-2, -1, 4, 2); G.restore(); }
    g.bubbles.forEach(bl => { G.fillStyle = 'rgba(220,255,235,.3)'; G.beginPath(); G.arc(b.x + bl.x * b.w * .35, base - bl.y * (base - ly), bl.r, 0, 7); G.fill(); });
  });
  if (o.steam) drawSteam(b.x, ly, g.heatS * 0.9, g.t, '210,255,225');
  hud(g, o.stat(g));
}
function drawSolidsGame(g) {
  const cx = W / 2, floorY = H * 0.66, ramTop = H * 0.24;
  G.strokeStyle = 'rgba(120,140,150,.5)'; G.lineWidth = 8; G.beginPath(); G.moveTo(cx - 72, ramTop - 4); G.lineTo(cx - 72, floorY); G.moveTo(cx + 72, ramTop - 4); G.lineTo(cx + 72, floorY); G.moveTo(cx - 84, ramTop - 4); G.lineTo(cx + 84, ramTop - 4); G.stroke();
  const ramY = ramTop + clamp(g.force, 0, 1) * (floorY - ramTop - 42);
  const rg = G.createLinearGradient(cx - 44, 0, cx + 44, 0); rg.addColorStop(0, '#2a3138'); rg.addColorStop(.5, '#6b747d'); rg.addColorStop(1, '#20262b');
  G.fillStyle = rg; G.fillRect(cx - 30, ramTop, 60, ramY - ramTop); G.fillStyle = '#6b747d'; G.fillRect(cx - 52, ramY, 104, 20);
  G.fillStyle = 'rgba(255,255,255,.14)'; G.fillRect(cx - 26, ramTop + 4, 5, ramY - ramTop);
  G.fillStyle = '#20262b'; G.fillRect(cx - 58, floorY, 116, 18);
  for (let i = 0; i < Math.min(g.pressIdx, g.presses); i++) { G.fillStyle = '#d6c8a0'; G.beginPath(); G.ellipse(cx - 38 + i * 26, floorY + 4, 10, 4, 0, 0, 7); G.fill(); G.strokeStyle = 'rgba(0,0,0,.3)'; G.stroke(); }
  const gx = cx + 122, gy = ramTop, gh = floorY - gy;
  G.fillStyle = '#0a0f0c'; G.strokeStyle = 'rgba(132,150,168,.3)'; roundRect(gx, gy, 16, gh, 4); G.fill(); G.stroke();
  const by0 = gy + gh * (1 - (g.target + g.band)), bh = gh * g.band * 2;
  G.fillStyle = 'rgba(255,178,62,.28)'; G.fillRect(gx, by0, 16, bh); G.strokeStyle = 'rgba(255,178,62,.8)'; G.strokeRect(gx, by0, 16, bh);
  const ny = gy + gh * (1 - clamp(g.force, 0, 1)); G.fillStyle = Math.abs(g.force - g.target) < g.band ? '#4fe08a' : g.force > g.target ? '#ff4a5b' : '#5fd0e0'; G.fillRect(gx - 4, ny - 2, 24, 4);
  G.fillStyle = '#6f8a7c'; G.font = '8px monospace'; G.textAlign = 'center'; G.fillText('FORCE', gx + 8, gy - 6);
  hud(g, `PRESS ${Math.min(g.pressIdx + 1, g.presses)} / ${g.presses}`);
}
function drawGasGame(g) {
  const cx = W / 2, cy = H * 0.42, R = 100;
  G.fillStyle = '#2a333a'; roundRect(cx - 40, cy + R - 12, 80, 130, 10); G.fill(); G.strokeStyle = 'rgba(200,230,235,.4)'; G.lineWidth = 2; roundRect(cx - 40, cy + R - 12, 80, 130, 10); G.stroke();
  G.fillStyle = '#0c1114'; G.beginPath(); G.arc(cx, cy, R, 0, 7); G.fill();
  G.strokeStyle = 'rgba(200,220,225,.45)'; G.lineWidth = 3; G.beginPath(); G.arc(cx, cy, R, 0, 7); G.stroke();
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, span = a1 - a0;
  G.strokeStyle = 'rgba(150,180,190,.4)'; G.lineWidth = 1; for (let i = 0; i <= 10; i++) { const a = a0 + span * (i / 10); G.beginPath(); G.moveTo(cx + Math.cos(a) * (R - 9), cy + Math.sin(a) * (R - 9)); G.lineTo(cx + Math.cos(a) * (R - 2), cy + Math.sin(a) * (R - 2)); G.stroke(); }
  G.strokeStyle = 'rgba(79,224,138,.7)'; G.lineWidth = 6; G.beginPath(); G.arc(cx, cy, R - 15, a0 + span * (g.target - g.band), a0 + span * (g.target + g.band)); G.stroke();
  G.strokeStyle = 'rgba(255,74,91,.7)'; G.lineWidth = 6; G.beginPath(); G.arc(cx, cy, R - 15, a0 + span * 0.9, a1); G.stroke();
  const na = a0 + span * clamp(g.pressure, 0, 1), nc = Math.abs(g.pressure - g.target) <= g.band ? '#4fe08a' : (g.pressure > 0.9 ? '#ff4a5b' : '#5fd0e0');
  G.strokeStyle = nc; G.lineWidth = 3; G.beginPath(); G.moveTo(cx, cy); G.lineTo(cx + Math.cos(na) * (R - 18), cy + Math.sin(na) * (R - 18)); G.stroke();
  G.fillStyle = '#20262b'; G.beginPath(); G.arc(cx, cy, 7, 0, 7); G.fill();
  if (g.vent > 0.05) { G.save(); G.globalCompositeOperation = 'lighter'; for (let i = 0; i < 3; i++) { G.globalAlpha = g.vent * (.35 - i * .08); G.fillStyle = 'rgba(200,230,240,1)'; G.beginPath(); G.arc(cx + 46 + i * 9, cy + R - 6 - i * 8, 3 + i * 2, 0, 7); G.fill(); } G.restore(); }
  hud(g, `PRESSURE ${Math.round(g.pressure * 100)} · TAP to vent · ${Math.max(0, g.dur - g.t).toFixed(1)}s`);
}

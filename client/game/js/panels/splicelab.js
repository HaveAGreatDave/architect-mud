// SPLICE — the master-tier compound splicer, an "orchestra of motion and
// timing." Two overlays, matching the server's authoritative 2-step protocol:
//
//   openSpliceSelect(msg)  ← `splice_designer`  — drag drug packages (by FORM:
//        liquid/powder/gel/pill, each sloshing under physics) into the reaction
//        cradle. Base = first dropped, grafts = the rest. On SPLICE it sends
//        `splicebegin <b64 {base,grafts,name}>` (real) or, in dev test mode,
//        flows straight into the stages client-side.
//
//   openSpliceStages(opts) ← `synth_minigame kind:splice` — MIX → POUR → STIR →
//        STABILIZE → SET(rhythm). The five stage scores are aggregated into one
//        0–100 and reported via `spliceresolve <token> <score>`; the SERVER
//        rolls the authoritative chemistry check + decides catastrophe. (Test
//        mode plays a client-side result card + blow-up instead.)
//
// Rendering/audio come from lab-kit.js. The chosen drugs' visuals are stashed
// between the two overlays so the stages know what they're mixing.

import { sendCmdSilent } from '../net.js';
import {
  clamp, lerp, rnd, ease, shade, mixColors, avgColor,
  G, W, H, roundRect, blob, fillLiquid, drawSteam,
  drawBench, drawBeaker, drawBurner, AX, mountLab, evPos,
} from './lab-kit.js';

// ── module state ─────────────────────────────────────────────────────────────
let game = null;                 // current session
let stage = null;                // current stage object (singleton)
let _stash = null;               // { selection, instability } carried select→stages
const ptr = { x: W / 2, y: H / 2, down: false };
const b64 = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const subFor = (f) => ({ liquid: 'thin', powder: 'fine', gel: 'viscous', pill: 'tablet' }[f] || 'thin');
function redact(s, known) { if (known >= .75) return esc(s); if (known < .25) return `<span class="redact">${'█'.repeat(Math.min(22, Math.max(6, String(s).length)))}</span>`;
  return String(s).split('').map(c => (c === ' ' || Math.random() < known) ? esc(c) : '<span class="redact">█</span>').join(''); }

// ── entry points ─────────────────────────────────────────────────────────────
export function openSpliceSelect(msg) {
  closeSplice();
  const lab = mountLab({ title: 'CHIMERA-9', subtitle: 'SPLICE · SELECT', accent: '#4fe08a', showInsta: true });
  ensureLabelStyle();
  game = newSession(lab, msg.test ? 'test' : 'real');
  game.drugs = (msg.drugs || []).map(d => ({
    drug: d.drug, name: d.name, blocks: d.blocks || {},
    form: d.form || 'liquid', color: d.color || '#4fe08a', sub: d.sub || subFor(d.form || 'liquid'),
    vol: d.vol ?? .4, known: d.known ?? 1,
  }));
  game.difficulty = msg.baseDifficulty || 8;
  wireInput(game);
  go(game, 'select');
  game.raf = requestAnimationFrame(loop);
}

export function openSpliceStages(opts) {
  closeSplice();
  const lab = mountLab({ title: 'CHIMERA-9', subtitle: 'SPLICE · REACTION', accent: '#4fe08a', showInsta: true });
  game = newSession(lab, 'real');
  const sel = (_stash && _stash.selection) || [];
  game.drugs = sel; game.selected = sel.slice();
  game.instability = (_stash && _stash.instability) || 0;
  game.difficulty = opts.difficulty || 8;
  game.onResolve = opts.onResult || null;
  wireInput(game);
  lab.setInsta(game.instability);
  go(game, 'mix');
  game.raf = requestAnimationFrame(loop);
}

// dispatch may call this to force-close on nav/logout
export function closeSplice() { if (game && game.lab) game.lab.close(); }

function newSession(lab, mode) {
  return {
    lab, mode, closed: false,
    drugs: [], selected: [], difficulty: 8, instability: 0, blown: false,
    scores: { mix: 0, pour: 0, stir: 0, heat: 0, rhythm: 0 },
    onResolve: null, raf: null, last: performance.now(), transition: 0, transitTo: null,
    diff() { return this.difficulty; },
    vol() { let v = 0; (this.selected || []).forEach(s => v = Math.max(v, s.vol || .4)); return clamp(v, .2, 1); },
  };
}

// ── instability + (test-only) catastrophe ────────────────────────────────────
function addInstability(amt, reason) {
  const g = game; if (!g) return;
  g.instability = clamp(g.instability + amt, 0, 100);
  g.lab.setInsta(g.instability);
  if (reason && amt > 2) g.lab.ticker(reason, 'a');
  if (g.mode === 'test' && g.instability >= 88 && !g.blown && Math.random() < catastropheChance() * 1.4) catastrophe(reason || 'the reaction');
}
function catastropheChance() {
  const g = game; const base = .05;
  const iFac = Math.max(0, (g.instability - 60) / 40);
  return clamp(base * (0.3 + iFac) + (g.difficulty > 10 ? .1 : 0) * iFac, 0, .9);
}

// ── stage machine ────────────────────────────────────────────────────────────
function go(g, name) {
  if (stage && stage.exit) stage.exit();
  g.lab.ui.innerHTML = ''; hideLabel();
  stage = STAGES[name];
  if (stage.enter) stage.enter();
}
function transit(g, to) { if (g.transition > 0) return; g.transitTo = to; g.transition = 0.001; AX.noise(.4, { gain: .2, freq: 1200, type: 'bandpass', q: .7 }); }
function drawTransition(t) {
  const tt = clamp(t, 0, 1); G.save(); G.globalAlpha = tt < .5 ? ease(tt * 2) : ease((1 - tt) * 2);
  G.fillStyle = '#04070a'; G.fillRect(0, 0, W, H);
  G.globalAlpha = Math.sin(tt * Math.PI); G.strokeStyle = 'rgba(79,224,138,.4)'; G.lineWidth = 2;
  for (let i = 0; i < 6; i++) { const y = H * (i / 6) + ((t * 400) % (H / 6)); G.beginPath(); G.moveTo(0, y); G.lineTo(W, y); G.stroke(); }
  G.restore();
}
function loop(now) {
  const g = game; if (!g || g.closed) return;
  let dt = (now - g.last) / 1000; g.last = now; if (dt > .05) dt = .05;
  if (stage && stage.update) stage.update(dt);
  G.clearRect(0, 0, W, H); drawBench();
  if (stage && stage.draw) stage.draw(dt);
  if (g.transition > 0) { g.transition += dt * 2.4; drawTransition(g.transition); if (g.transition >= 1 && g.transitTo) { const t = g.transitTo; g.transitTo = null; g.transition = 0; go(g, t); } }
  g.raf = requestAnimationFrame(loop);
}
function wireInput(g) {
  const canvas = g.lab.canvas;
  const onMove = e => { const p = evPos(canvas, e); ptr.x = p.x; ptr.y = p.y; if (stage && stage.move) stage.move(p); };
  const onDown = e => { AX.tick(); const p = evPos(canvas, e); ptr.x = p.x; ptr.y = p.y; ptr.down = true; if (stage && stage.down) stage.down(p); };
  const onUp = () => { ptr.down = false; if (stage && stage.up) stage.up(); };
  const onKey = e => { if (e.key === 'Escape') { g.lab.close(); return; } if (e.repeat) return; if (stage && stage.key) stage.key(e); };
  const onKeyUp = e => { if (stage && stage.keyup) stage.keyup(e); };
  canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp); window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKeyUp);
  g.lab.onClose(() => { g.closed = true; canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerdown', onDown); window.removeEventListener('pointerup', onUp); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); if (g.raf) cancelAnimationFrame(g.raf); });
}
function mkBtn(label, style, cls) { return game.lab.mkBtn(label, style, cls); }
function mkEl(style) { const d = document.createElement('div'); d.setAttribute('style', style); game.lab.ui.appendChild(d); return d; }

// ── knowledge label card (SELECT) ────────────────────────────────────────────
let _labelEl = null;
function ensureLabelStyle() {
  if (document.getElementById('splice-label-styles')) return;
  const s = document.createElement('style'); s.id = 'splice-label-styles';
  s.textContent = `
  .splice-label{position:absolute;z-index:9;width:200px;pointer-events:none;background:linear-gradient(180deg,#0e1512,#080c0a);border:1px solid rgba(79,224,138,.4);border-radius:5px;padding:9px 10px;box-shadow:0 10px 30px rgba(0,0,0,.8);font-size:10px;font-family:var(--font-mono,monospace)}
  .splice-label .nm{font-size:13px;letter-spacing:2px;color:#4fe08a;font-weight:bold;text-transform:uppercase}
  .splice-label .row{display:flex;justify-content:space-between;color:#6f8a7c;margin:2px 0;text-transform:uppercase;font-size:8px;letter-spacing:1px}
  .splice-label .row b{color:#cfe9d8}
  .splice-label .blk{border-top:1px dashed rgba(79,224,138,.25);padding-top:5px;margin-top:5px;color:#cfe9d8;line-height:1.4}
  .splice-label .redact{color:#3a4a42;background:#111}
  .splice-label .known{position:absolute;top:8px;right:10px;font-size:7px;color:#6f8a7c;letter-spacing:1px}`;
  document.head.appendChild(s);
}
function showLabel(d, lx, ly) {
  hideLabel(); const el = document.createElement('div'); el.className = 'splice-label';
  const knw = Math.round((d.known ?? 1) * 100);
  const blocks = Object.entries(d.blocks || {}).map(([blk, sum]) => `<div class="blk">${blk.toUpperCase()}: ${redact(sum, d.known ?? 1)}</div>`).join('') || '<div class="blk">No graftable effects.</div>';
  el.innerHTML = `<span class="known">FAMILIARITY ${knw}%</span>
    <div class="nm">${(d.known ?? 1) > .4 ? esc(d.name) : 'UNIDENTIFIED'}</div>
    <div class="row"><span>form</span><b>${d.form} / ${d.sub}</b></div>
    <div class="row"><span>volatility</span><b>${d.vol > .7 ? 'EXTREME' : d.vol > .45 ? 'HIGH' : d.vol > .3 ? 'MODERATE' : 'LOW'}</b></div>
    ${blocks}`;
  el.style.left = clamp(lx / W * 100, 1, 76) + '%';
  el.style.top = clamp(ly / H * 100 + 8, 1, 62) + '%';
  game.lab.ui.appendChild(el); _labelEl = el; _labelFor = d;
}
let _labelFor = null;
function hideLabel() { if (_labelEl) { _labelEl.remove(); _labelEl = null; } _labelFor = null; }

// ── drug package (by FORM, physics-tilted, sloshing) ─────────────────────────
function drawPackage(d, x, y, inCradle, hi, t, phys) {
  phys = phys || {}; const tilt = phys.tilt || 0, slosh = phys.slosh || 0, warn = phys.warn || 0, held = phys.held, c = d.color;
  G.save(); G.translate(x, y); G.rotate(tilt);
  if (hi || inCradle || warn > 0.05) { G.shadowColor = warn > 0.1 ? `rgba(255,90,90,${clamp(warn, 0, 1)})` : c; G.shadowBlur = held ? 26 : (inCradle ? 18 : 12); }
  if (d.form === 'liquid') {
    const gw = 26, gh = 62;
    G.fillStyle = 'rgba(200,225,235,.10)'; roundRect(-gw / 2, -gh / 2, gw, gh, 8); G.fill();
    G.save(); roundRect(-gw / 2 + 2, -gh / 2 + 3, gw - 4, gh - 6, 6); G.clip();
    const fillTop = 6, s = -tilt;
    G.beginPath(); G.moveTo(-gw / 2, gh / 2);
    for (let px = -gw / 2; px <= gw / 2; px += 3) G.lineTo(px, fillTop + s * px + Math.sin(px * 0.35 + t * 7) * slosh * 2.4);
    G.lineTo(gw / 2, gh / 2); G.closePath();
    const lg = G.createLinearGradient(0, fillTop - 6, 0, gh / 2); lg.addColorStop(0, shade(c, 42)); lg.addColorStop(.2, c); lg.addColorStop(1, shade(c, -46));
    G.fillStyle = lg; G.fill();
    G.strokeStyle = shade(c, 72); G.lineWidth = 1.3; G.beginPath();
    for (let px = -gw / 2; px <= gw / 2; px += 3) { const yy = fillTop + s * px + Math.sin(px * 0.35 + t * 7) * slosh * 2.4; px === -gw / 2 ? G.moveTo(px, yy) : G.lineTo(px, yy); } G.stroke();
    for (let i = 0; i < 3; i++) { G.fillStyle = 'rgba(255,255,255,.22)'; G.beginPath(); G.arc(Math.sin(t * 2 + i + slosh) * 5, 16 + Math.cos(t * 1.7 + i) * 7, 1.5, 0, 7); G.fill(); }
    G.restore();
    G.strokeStyle = 'rgba(215,240,245,.55)'; G.lineWidth = 1.6; roundRect(-gw / 2, -gh / 2, gw, gh, 8); G.stroke();
    G.fillStyle = 'rgba(255,255,255,.16)'; G.fillRect(-gw / 2 + 4, -gh / 2 + 8, 3, gh - 18);
    G.fillStyle = '#2a343a'; roundRect(-8, -gh / 2 - 8, 16, 10, 2); G.fill(); G.fillStyle = '#1a2024'; G.fillRect(-6, -gh / 2 - 1, 12, 3);
  } else if (d.form === 'powder') {
    const bw = 42, bh = 58;
    G.fillStyle = 'rgba(200,220,230,.10)'; roundRect(-bw / 2, -bh / 2, bw, bh, 4); G.fill();
    G.save(); roundRect(-bw / 2 + 3, -bh / 2 + 10, bw - 6, bh - 16, 3); G.clip();
    const shift = slosh * 6;
    G.fillStyle = shade(c, -6); G.beginPath(); G.moveTo(-bw / 2, bh / 2);
    for (let px = -bw / 2; px <= bw / 2; px += 4) G.lineTo(px, bh / 2 - 14 - Math.cos(px * 0.11) * 4 - px * 0.02 * shift);
    G.lineTo(bw / 2, bh / 2); G.closePath(); G.fill();
    for (let i = 0; i < 26; i++) { G.fillStyle = i % 3 ? shade(c, 22) : shade(c, -28); G.fillRect(-bw / 2 + 2 + Math.random() * (bw - 4), bh / 2 - 2 - Math.random() * 20, 1.4, 1.4); }
    if (d.sub === 'crystalline') { G.fillStyle = 'rgba(255,255,255,.45)'; for (let i = 0; i < 6; i++) { G.save(); G.translate(-12 + Math.random() * 24, bh / 2 - 4 - Math.random() * 14); G.rotate(Math.random() * 3); G.fillRect(-1, -3, 2, 6); G.restore(); } }
    G.restore();
    G.strokeStyle = 'rgba(210,230,240,.4)'; G.lineWidth = 1.2; roundRect(-bw / 2, -bh / 2, bw, bh, 4); G.stroke();
    G.fillStyle = 'rgba(232,242,246,.7)'; G.fillRect(-bw / 2, -bh / 2, bw, 7);
    G.strokeStyle = 'rgba(120,140,150,.5)'; G.lineWidth = 1; for (let i = -bw / 2 + 2; i < bw / 2; i += 3) { G.beginPath(); G.moveTo(i, -bh / 2); G.lineTo(i, -bh / 2 + 6); G.stroke(); }
    G.fillStyle = 'rgba(255,255,255,.10)'; G.fillRect(-bw / 2 + 4, -bh / 2 + 10, 3, bh - 22);
  } else if (d.form === 'gel') {
    const amp = 1 + Math.abs(slosh) * 0.5;
    const gg = G.createRadialGradient(-4, -4, 3, 0, 4, 26 * amp); gg.addColorStop(0, shade(c, 72)); gg.addColorStop(1, shade(c, -18));
    G.fillStyle = gg; blob(0, 0, 24 * amp, 20 / amp, t * 1.6 + slosh * 3); G.fill();
    G.strokeStyle = 'rgba(255,255,255,.5)'; G.lineWidth = 1.4; blob(0, 0, 24 * amp, 20 / amp, t * 1.6 + slosh * 3); G.stroke();
    G.fillStyle = 'rgba(255,255,255,.4)'; G.beginPath(); G.arc(Math.sin(t * 1.3) * 5 + slosh * 6, Math.cos(t * 1.1) * 4, 4, 0, 7); G.fill();
    G.globalAlpha = .5; G.fillStyle = shade(c, 90); G.beginPath(); G.arc(slosh * 4, 2, 8, 0, 7); G.fill(); G.globalAlpha = 1;
  } else {
    const bw = 46, bh = 40;
    G.fillStyle = 'rgba(180,190,200,.32)'; roundRect(-bw / 2, -bh / 2, bw, bh, 4); G.fill();
    for (let r = 0; r < 2; r++) for (let cc = 0; cc < 3; cc++) { const px = -14 + cc * 14, py = -8 + r * 16 + slosh * 1.4 * (r ? 1 : -1);
      G.fillStyle = 'rgba(230,235,240,.5)'; G.beginPath(); G.arc(px, py, 6, 0, 7); G.fill();
      G.fillStyle = c; G.beginPath(); G.arc(px, py, 4.4, 0, 7); G.fill();
      G.fillStyle = 'rgba(255,255,255,.5)'; G.fillRect(px - 3, py - .5, 6, 1); }
    G.strokeStyle = 'rgba(200,210,220,.4)'; G.lineWidth = 1; roundRect(-bw / 2, -bh / 2, bw, bh, 4); G.stroke();
    G.fillStyle = 'rgba(255,255,255,.10)'; roundRect(-bw / 2 + 3, -bh / 2 + 3, bw - 6, 5, 2); G.fill();
  }
  G.shadowBlur = 0; G.restore();
  G.textAlign = 'center';
  G.fillStyle = inCradle ? '#4fe08a' : (hi ? '#dffbe9' : '#7f9a8c'); G.font = (inCradle ? 'bold ' : '') + '10px monospace';
  G.fillText((d.known ?? 1) > .4 ? d.name : '???', x, y + 46);
  if (inCradle) { const idx = game.selected.indexOf(d); G.fillStyle = '#4fe08a'; G.font = 'bold 9px monospace'; G.fillText(idx === 0 ? '◆ BASE' : '+ GRAFT', x, y + 58); }
}

// ══ STAGES ═══════════════════════════════════════════════════════════════════
const STAGES = {};

STAGES.select = {
  enter() {
    const g = game; const freq = { liquid: 2.0, gel: 2.1, powder: 2.4, pill: 2.8 };
    const fluidOf = { thin: 1, oil: 1, solvent: 1, fine: .28, crystalline: .22, viscous: .55, tablet: .06 };
    const zeta = 0.62, n = g.drugs.length, cols = Math.min(4, Math.max(1, n)), gapx = 176, x0 = (W - (cols - 1) * gapx) / 2;
    this.pkgs = g.drugs.map((d, i) => { const col = i % cols, row = Math.floor(i / cols), hx = x0 + col * gapx, hy = H * 0.28 + row * 128;
      const w = 2 * Math.PI * (freq[d.form] || 2.2), k = w * w, c = 2 * zeta * w;
      return { d, home: { x: hx, y: hy }, x: hx, y: hy, vx: 0, vy: 0, pvx: 0, tilt: 0, slosh: 0, sloshV: 0, held: false, inCradle: false, gdx: 0, gdy: 0, k, c, fluid: fluidOf[d.sub] ?? .3, spill: 0, warn: 0 }; });
    this.cradle = { x: W / 2, y: H - 104, r: 62 };
    this.drag = null; this.pressP = null; this.pressT = 0; this.moved = false; this.hover = null; this.t = 0; this.drips = [];
    this.mkBtns(); g.selected = [];
    g.lab.ticker('drag a package into the cradle. carry it steady — slosh a volatile one and it spits at you. tap to read a label.');
    AX.loop('hood', { freq: 60, type: 'sawtooth', gain: .03, filt: 340, tremRate: 7, tremDepth: .3 });
  },
  exit() { AX.stop('hood'); game.lab.canvas.style.cursor = 'default'; },
  mkBtns() {
    this.splice = mkBtn('SPLICE ▶', 'left:50%;bottom:16px;transform:translateX(-50%)'); this.splice.disabled = true;
    this.splice.onclick = () => { if (game.selected.length < 2) return; AX.click(); this.commit(); };
    const clr = mkBtn('CLEAR', 'left:16px;bottom:16px', 'ghost');
    clr.onclick = () => { AX.click(); this.pkgs.forEach(p => p.inCradle = false); game.selected = []; this.sync(); };
    this.hint = mkEl('position:absolute;left:50%;bottom:50px;transform:translateX(-50%);color:#6f8a7c;font-size:9px;letter-spacing:1px;text-transform:uppercase;pointer-events:none;text-align:center;width:82%');
  },
  sync() { const n = game.selected.length; this.splice.disabled = n < 2;
    this.hint.textContent = n ? `${game.selected[0].name} base${n > 1 ? ` · ${n - 1} graft${n - 1 === 1 ? '' : 's'}` : ''} — drop at least two` : 'drop at least two into the cradle';
  },
  commit() {
    const sel = game.selected.slice();
    _stash = { selection: sel, instability: game.instability };
    if (game.mode === 'test') { transit(game, 'mix'); return; }
    // build the server payload: base + every block of each graft drug
    const base = sel[0].drug;
    const grafts = [];
    for (let i = 1; i < sel.length; i++) for (const blk of Object.keys(sel[i].blocks || {})) grafts.push({ drug: sel[i].drug, block: blk });
    sendCmdSilent('splicebegin ' + b64({ base, grafts, name: '' }));
    game.lab.close(); // server replies synth_minigame:splice → openSpliceStages
  },
  topAt(p) { for (let i = this.pkgs.length - 1; i >= 0; i--) { const k = this.pkgs[i]; if (Math.hypot(p.x - k.x, p.y - k.y) < 44) return k; } return null; },
  move(p) { if (this.drag && !this.moved && Math.hypot(p.x - this.pressP.x, p.y - this.pressP.y) > 6) this.moved = true;
    this.hover = this.drag || this.topAt(p); game.lab.canvas.style.cursor = this.hover ? (this.drag ? 'grabbing' : 'grab') : 'default'; },
  down(p) { const k = this.topAt(p); if (!k) { hideLabel(); return; }
    this.drag = k; k.held = true; k.gdx = k.x - p.x; k.gdy = k.y - p.y; this.pressP = { x: p.x, y: p.y }; this.pressT = this.t; this.moved = false;
    this.pkgs.splice(this.pkgs.indexOf(k), 1); this.pkgs.push(k);
    if (k.inCradle) { k.inCradle = false; game.selected = game.selected.filter(d => d !== k.d); this.sync(); } AX.tick(); },
  up() { const k = this.drag; if (!k) return; this.drag = null; k.held = false;
    if (!this.moved && (this.t - this.pressT) < 0.25) { if (_labelFor === k.d && _labelEl) hideLabel(); else showLabel(k.d, k.home.x, k.home.y); return; }
    if (Math.hypot(k.x - this.cradle.x, k.y - this.cradle.y) < this.cradle.r + 12) {
      if (game.selected.length >= 4 && !game.selected.includes(k.d)) { game.lab.ticker("cradle's full. four is already ambitious.", 'a'); AX.bad(); }
      else { k.inCradle = true; if (!game.selected.includes(k.d)) game.selected.push(k.d); AX.drop(); this.sync(); }
    } else AX.tick();
    hideLabel(); },
  update(dt) { this.t += dt; const cr = this.cradle, inC = this.pkgs.filter(p => p.inCradle);
    this.pkgs.forEach(p => { let tx, ty, k = p.k;
      if (this.drag === p) { tx = ptr.x + p.gdx; ty = ptr.y + p.gdy; }
      else if (p.inCradle) { const idx = inC.indexOf(p), n = inC.length, a = -Math.PI / 2 + (idx - (n - 1) / 2) * 0.52; tx = cr.x + Math.cos(a) * 48; ty = cr.y + Math.sin(a) * 22 - 6; k *= 1.5; }
      else { tx = p.home.x; ty = p.home.y; }
      const ax = (tx - p.x) * k - p.vx * p.c, ay = (ty - p.y) * k - p.vy * p.c; p.vx += ax * dt; p.vy += ay * dt;
      const sp = Math.hypot(p.vx, p.vy); if (sp > 1000) { p.vx *= 1000 / sp; p.vy *= 1000 / sp; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.tilt = lerp(p.tilt, clamp(-p.vx * 0.0016, -0.42, 0.42), dt * 9);
      const dax = p.vx - p.pvx; p.pvx = p.vx;
      p.sloshV += dax * p.fluid * 0.6; p.sloshV += (-p.slosh * 38 - p.sloshV * 3.6) * dt; p.slosh = clamp(p.slosh + p.sloshV * dt, -1.5, 1.5);
      if (this.drag === p && p.fluid > 0.7 && Math.abs(p.slosh) > 0.95) { p.warn = 1; p.spill += dt * Math.abs(p.slosh);
        if (Math.random() < 0.35) this.drips.push({ x: p.x + rnd(15, -15), y: p.y + 12, vy: 50, life: 0, col: p.d.color });
        if (p.spill > 1.3) { p.spill = 0; addInstability(6, 'you slopped it — that residue will bite you later.'); AX.bad(); }
      } else { p.warn = lerp(p.warn, 0, dt * 4); p.spill = Math.max(0, p.spill - dt * 0.5); }
    });
    this.drips.forEach(d => { d.life += dt; d.y += d.vy * dt; d.vy += 400 * dt; }); this.drips = this.drips.filter(d => d.life < 0.6);
  },
  draw() { const cr = this.cradle;
    G.strokeStyle = 'rgba(120,150,140,.10)'; G.lineWidth = 2;
    [H * 0.28 + 31, H * 0.28 + 128 + 31].forEach(sy => { G.beginPath(); G.moveTo(W * 0.12, sy); G.lineTo(W * 0.88, sy); G.stroke(); G.fillStyle = 'rgba(0,0,0,.28)'; G.fillRect(W * 0.12, sy, W * 0.76, 3); });
    const pulse = .5 + .5 * Math.sin(this.t * 3);
    const cg = G.createRadialGradient(cr.x, cr.y, 6, cr.x, cr.y, cr.r + 34); cg.addColorStop(0, `rgba(79,224,138,${.13 + pulse * .1})`); cg.addColorStop(1, 'rgba(79,224,138,0)');
    G.fillStyle = cg; G.beginPath(); G.ellipse(cr.x, cr.y, cr.r + 34, cr.r * .62, 0, 0, 7); G.fill();
    G.strokeStyle = 'rgba(120,150,150,.5)'; G.lineWidth = 3; G.beginPath(); G.ellipse(cr.x, cr.y + 4, cr.r * .78, cr.r * .36, 0, 0.1, Math.PI - 0.1, false); G.stroke();
    G.strokeStyle = 'rgba(79,224,138,.4)'; G.setLineDash([7, 6]); G.lineWidth = 1.6; G.beginPath(); G.ellipse(cr.x, cr.y, cr.r, cr.r * .5, 0, 0, 7); G.stroke(); G.setLineDash([]);
    G.fillStyle = 'rgba(111,138,124,.7)'; G.font = '9px monospace'; G.textAlign = 'center'; G.fillText('REACTION CRADLE', cr.x, cr.y + cr.r * .5 + 18);
    this.drips.forEach(d => { G.globalAlpha = 1 - d.life / 0.6; G.fillStyle = d.col; G.beginPath(); G.arc(d.x, d.y, 2.2, 0, 7); G.fill(); }); G.globalAlpha = 1;
    this.pkgs.forEach(p => { const groundY = p.inCradle ? cr.y + 26 : p.home.y + 40, lift = clamp((groundY - p.y) / 120, 0, 1);
      G.save(); G.globalAlpha = .42 * (1 - lift * .5); G.fillStyle = '#000'; G.beginPath(); G.ellipse(p.x, groundY, 20 + lift * 8, 5, 0, 0, 7); G.fill(); G.restore();
      drawPackage(p.d, p.x, p.y, p.inCradle, this.hover === p || this.drag === p, this.t, { tilt: p.tilt, slosh: p.slosh, warn: p.warn, held: this.drag === p }); });
  },
};

STAGES.mix = {
  enter() { const g = game; this.t = 0; this.homog = 0; this.agit = 0; this.target = .55; this.added = 0; this.hold = false;
    this.forms = g.selected.map(s => s.sub); this.immiscible = this.forms.includes('oil') || this.forms.includes('solvent');
    this.powdery = this.forms.every(f => ['fine', 'crystalline'].includes(f)); this.particles = []; this.done = false; this.overd = 0;
    this.beaker = { x: W / 2, y: H * 0.5, w: 150, h: 210 };
    this.action = this.immiscible ? 'EMULSIFY — the layers refuse to mix' : this.powdery ? 'FOLD — blend the powders evenly' : 'DISSOLVE — work the powder into solution';
    g.lab.ticker(`${this.action}. hold to agitate; keep it in the amber zone — don't thrash it.`);
    this.b = mkBtn('LOCK IN MIX', 'left:50%;bottom:20px;transform:translateX(-50%)'); this.b.disabled = true; this.b.onclick = () => this.finish();
    let dd = .4; g.selected.forEach((d, i) => setTimeout(() => { if (game !== g || g.closed) return; this.added++; AX.drop(); this.splash(d.color); }, dd * 1000 + i * 450));
    AX.loop('whir', { freq: 120, type: 'triangle', gain: 0, filt: 700, tremRate: 22, tremDepth: .6 });
  },
  exit() { AX.stop('whir'); },
  splash(col) { for (let i = 0; i < 14; i++) this.particles.push({ x: this.beaker.x + rnd(30, -30), y: this.beaker.y - 80, vx: rnd(60, -60), vy: rnd(-40, -120), life: 0, ttl: .6, col }); },
  down() { this.hold = true; }, up() { this.hold = false; },
  key(e) { if (e.code === 'Space') { e.preventDefault(); this.hold = true; } }, keyup(e) { if (e.code === 'Space') this.hold = false; },
  update(dt) { this.t += dt; this.agit = lerp(this.agit, this.hold ? 1 : 0, dt * (this.hold ? 3 : 2.2)); AX.loopGain('whir', this.agit * .12);
    if (this.added < game.selected.length) return;
    const band = clamp(.16 - game.diff() * 0.004, .06, .16), inZone = Math.abs(this.agit - this.target) < band;
    if (inZone) this.homog = clamp(this.homog + dt * (this.immiscible ? .28 : .42), 0, 1);
    else if (this.agit > this.target + band) { this.overd += dt; addInstability(dt * 7 * game.vol(), 'over-agitating'); }
    if (this.immiscible && this.agit < this.target - band) this.homog = clamp(this.homog - dt * .12, 0, 1);
    this.particles.forEach(p => { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; }); this.particles = this.particles.filter(p => p.life < p.ttl);
    if (this.homog >= 1 && !this.done) { this.done = true; this.b.disabled = false; AX.good(); game.lab.ticker('homogeneous. lock it in.'); }
  },
  finish() { if (this.done === 'locked') return; this.done = 'locked'; AX.click(); game.scores.mix = clamp(this.homog - this.overd * 0.06, 0, 1); addInstability((1 - game.scores.mix) * 10 * game.vol(), 'sloppy mix'); transit(game, 'pour'); },
  draw() { const b = this.beaker;
    drawBeaker(b, () => { const filled = this.added / Math.max(1, game.selected.length), top = b.y + b.h / 2 - (b.h * 0.66) * filled;
      if (this.immiscible && this.homog < .98) { const n = game.selected.length, area = (b.y + b.h / 2) - top;
        game.selected.forEach((d, i) => { const ly = top + area * (i / n) + Math.sin(this.t * 3 + i) * 4 * (1 - this.homog); const lh = area / n + 2;
          G.fillStyle = mixColors(d.color, avgColor(game.selected), this.homog); G.fillRect(b.x - b.w / 2, ly, b.w, lh + area * this.homog * 0.02); });
      } else { const col = avgColor(game.selected), top2 = top;
        fillLiquid(b.x - b.w / 2, b.w, top2, b.y + b.h / 2, col, col, this.t, this.agit * 0.4, 0.2);
        G.globalAlpha = (1 - this.homog) * .5; for (let i = 0; i < 20; i++) { G.fillStyle = shade(col, 40); const px = b.x + Math.sin(this.t * 2 + i) * b.w * .35, py = top2 + ((i * 13 + this.t * 20) % ((b.y + b.h / 2) - top2)); G.beginPath(); G.arc(px, py, 2.5, 0, 7); G.fill(); } G.globalAlpha = 1;
      }
      const cx = b.x, cyy = b.y + b.h * 0.18; G.strokeStyle = `rgba(255,255,255,${.1 + this.agit * .3})`; G.lineWidth = 2;
      for (let sN = 0; sN < 3; sN++) { G.beginPath(); for (let a = 0; a < Math.PI * 2; a += .3) { const rr = (18 + sN * 14) * (1 + this.agit * .3), wob = Math.sin(this.t * 8 + a * 3) * this.agit * 6; const px = cx + Math.cos(a + this.t * 4 * this.agit) * (rr + wob), py = cyy + Math.sin(a + this.t * 4 * this.agit) * (rr * .4 + wob * .4); a === 0 ? G.moveTo(px, py) : G.lineTo(px, py); } G.stroke(); }
    });
    this.particles.forEach(p => { G.globalAlpha = 1 - p.life / p.ttl; G.fillStyle = p.col; G.beginPath(); G.arc(p.x, p.y, 2.5, 0, 7); G.fill(); }); G.globalAlpha = 1;
    const gx = b.x + b.w / 2 + 40, gy = b.y - b.h / 2, gh = b.h;
    G.fillStyle = '#0a0f0c'; G.strokeStyle = 'rgba(132,150,168,.3)'; roundRect(gx, gy, 16, gh, 4); G.fill(); G.stroke();
    const band = clamp(.16 - game.diff() * 0.004, .06, .16);
    G.fillStyle = 'rgba(255,178,62,.25)'; G.fillRect(gx, gy + gh * (1 - (this.target + band)), 16, gh * band * 2);
    G.strokeStyle = 'rgba(255,178,62,.7)'; G.strokeRect(gx, gy + gh * (1 - (this.target + band)), 16, gh * band * 2);
    const ny = gy + gh * (1 - this.agit); G.fillStyle = Math.abs(this.agit - this.target) < band ? '#4fe08a' : this.agit > this.target ? '#ff4a5b' : '#5fd0e0'; G.fillRect(gx - 3, ny - 2, 22, 4);
    G.fillStyle = '#6f8a7c'; G.font = '10px monospace'; G.textAlign = 'center'; G.fillText(this.action, b.x, b.y - b.h / 2 - 30);
    G.fillStyle = '#4fe08a'; G.font = 'bold 13px monospace'; G.fillText('HOMOGENEITY ' + Math.round(this.homog * 100) + '%', b.x, b.y - b.h / 2 - 12);
  },
};

STAGES.pour = {
  enter() { const g = game; this.t = 0; this.stepIdx = 0; this.level = 0; this.vel = 0; this.pouring = false; this.locked = [];
    this.steps = [ { name: 'REAGENT', col: '#4fe08a', target: .55, band: clamp(.10 - g.diff() * .003, .04, .10) },
      { name: 'CATALYST', col: '#9a5ce0', target: .78, band: clamp(.075 - g.diff() * .003, .03, .075), touchy: true } ];
    this.drops = []; this.beaker = { x: W / 2, y: H * 0.5, w: 150, h: 210 };
    g.lab.ticker('pour the REAGENT to its line. hold to pour, release on the mark. the stream lags — anticipate.');
    this.b = mkBtn('HOLD TO POUR / RELEASE ON MARK', 'left:50%;bottom:20px;transform:translateX(-50%)', 'ghost'); this.b.style.pointerEvents = 'none';
  },
  exit() { AX.pour(false); },
  down() { this.startPour(); }, up() { this.endPour(); },
  key(e) { if (e.code === 'Space') { e.preventDefault(); this.startPour(); } }, keyup(e) { if (e.code === 'Space') this.endPour(); },
  startPour() { if (this.stepIdx >= this.steps.length || this.pouring) return; this.pouring = true; AX.pour(true); },
  endPour() { if (!this.pouring) return; this.pouring = false; AX.pour(false); this.lock(); },
  lock() { const s = this.steps[this.stepIdx], err = Math.abs(this.level - s.target), acc = clamp(1 - err / (s.band * 2.4), 0, 1), over = Math.max(0, this.level - (s.target + s.band));
    this.locked.push(acc);
    if (over > 0) { addInstability(over * 100 * (s.touchy ? 1.6 : 0.8), s.name + ' overpour'); AX.bad(); } else AX.good();
    game.lab.ticker(acc > .85 ? `${s.name}: dead on.` : acc > .5 ? `${s.name}: close enough.` : `${s.name}: ${this.level > s.target ? 'too much' : 'short'}.`, acc > .5 ? null : 'a');
    this.stepIdx++; this.level = 0; this.vel = 0;
    if (this.stepIdx >= this.steps.length) this.finish();
    else { const nx = this.steps[this.stepIdx]; game.lab.ticker(`now the ${nx.name}. ${nx.touchy ? 'this one bites — pour slow.' : ''}`); }
  },
  finish() { game.scores.pour = this.locked.reduce((a, b) => a + b, 0) / this.locked.length; setTimeout(() => { if (game && !game.closed) transit(game, 'stir'); }, 500); },
  update(dt) { this.t += dt; const s = this.steps[this.stepIdx]; if (!s) return;
    if (this.pouring) { this.vel += dt * (s.touchy ? 0.5 : 0.72); for (let i = 0; i < 2; i++) this.drops.push({ x: this.beaker.x + rnd(6, -6), y: this.beaker.y - this.beaker.h / 2 - 30, vy: 200, life: 0, col: s.col }); }
    this.vel *= Math.pow(0.1, dt); this.level = clamp(this.level + this.vel * dt, 0, 1); if (this.level >= 1 && this.pouring) this.endPour();
    this.drops.forEach(d => { d.life += dt; d.y += d.vy * dt; }); this.drops = this.drops.filter(d => d.life < .5);
  },
  draw() { const b = this.beaker, s = this.steps[this.stepIdx];
    drawBeaker(b, () => { let base = b.y + b.h / 2, acc = 0;
      this.locked.forEach((a, i) => { const st = this.steps[i], fh = b.h * 0.6 * st.target * 0.5; G.fillStyle = shade(st.col, -10); G.fillRect(b.x - b.w / 2, base - fh - acc, b.w, fh); acc += fh; });
      if (s) { const fh = b.h * 0.6 * this.level; fillLiquid(b.x - b.w / 2, b.w, base - fh - acc, base - acc, s.col, s.col, this.t, 0.2, 0); }
    });
    if (s) { const bx = b.x, byTop = b.y - b.h / 2;
      if (this.pouring) { G.strokeStyle = s.col; G.lineWidth = 3; G.globalAlpha = .8; G.beginPath(); G.moveTo(bx, byTop - 70); G.lineTo(bx + Math.sin(this.t * 30) * 2, byTop - 10); G.stroke(); G.globalAlpha = 1; }
      G.save(); G.translate(bx - 30, byTop - 92); G.rotate(this.pouring ? 0.5 : 0.15);
      G.fillStyle = 'rgba(200,220,225,.15)'; roundRect(0, 0, 30, 44, 5); G.fill(); G.fillStyle = s.col; G.fillRect(4, 20, 22, 20);
      G.strokeStyle = 'rgba(220,235,240,.5)'; roundRect(0, 0, 30, 44, 5); G.stroke(); G.fillStyle = '#2a343a'; G.fillRect(10, -8, 10, 10); G.restore();
      this.drops.forEach(d => { G.globalAlpha = 1 - d.life / .5; G.fillStyle = d.col; G.beginPath(); G.arc(d.x, d.y, 2.2, 0, 7); G.fill(); }); G.globalAlpha = 1;
      const gx = b.x + b.w / 2 + 30, gy = b.y - b.h / 2, gh = b.h;
      G.fillStyle = '#0a0f0c'; G.strokeStyle = 'rgba(132,150,168,.3)'; roundRect(gx, gy, 14, gh, 4); G.fill(); G.stroke();
      G.fillStyle = s.touchy ? 'rgba(154,92,224,.3)' : 'rgba(79,224,138,.25)'; G.fillRect(gx, gy + gh * (1 - (s.target + s.band)), 14, gh * s.band * 2);
      G.strokeStyle = s.touchy ? 'rgba(154,92,224,.8)' : 'rgba(79,224,138,.8)'; G.strokeRect(gx, gy + gh * (1 - (s.target + s.band)), 14, gh * s.band * 2);
      const ny = gy + gh * (1 - this.level), good = Math.abs(this.level - s.target) < s.band;
      G.fillStyle = good ? '#4fe08a' : this.level > s.target ? '#ff4a5b' : '#5fd0e0'; G.fillRect(gx - 4, ny - 2, 22, 4);
      G.fillStyle = '#6f8a7c'; G.font = '10px monospace'; G.textAlign = 'center'; G.fillText(`POURING: ${s.name}`, b.x, b.y - b.h / 2 - 28);
      G.fillStyle = s.touchy ? '#9a5ce0' : '#4fe08a'; G.font = 'bold 12px monospace'; G.fillText(`${this.stepIdx + 1} / ${this.steps.length}`, b.x, b.y - b.h / 2 - 12);
    }
  },
};

STAGES.stir = {
  enter() { const g = game; this.t = 0; this.angle = 0; this.rpm = 0; this.spin = 0; this.lastA = null; this.holdT = 0; this.need = 5.5;
    this.targetRpm = 0.55; this.band = clamp(.22 - g.diff() * .008, .1, .22); this.keyDir = 0; this.beaker = { x: W / 2, y: H * 0.5, w: 150, h: 210 }; this.ended = false;
    g.lab.ticker('STIR — trace circles over the beaker (or hold ← / →). hold the rod in the green RPM band.');
    this.bar = mkEl('position:absolute;left:50%;bottom:24px;transform:translateX(-50%);color:#6f8a7c;font-size:9px;letter-spacing:2px;text-transform:uppercase;pointer-events:none');
    AX.loop('stir', { freq: 80, type: 'sawtooth', gain: 0, filt: 500 });
  },
  exit() { AX.stop('stir'); },
  move(p) { const dx = p.x - this.beaker.x, dy = p.y - this.beaker.y, a = Math.atan2(dy, dx);
    if (this.lastA !== null) { let d = a - this.lastA; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; this.spin = Math.abs(d) * 3; } this.lastA = a; },
  key(e) { if (e.key === 'ArrowRight' || e.key === 'd') this.keyDir = 1; if (e.key === 'ArrowLeft' || e.key === 'a') this.keyDir = -1; },
  keyup(e) { if (['ArrowRight', 'd', 'ArrowLeft', 'a'].includes(e.key)) this.keyDir = 0; },
  update(dt) { this.t += dt; let input = this.spin || 0; this.spin *= 0.6; if (this.keyDir) input = Math.max(input, 0.14);
    this.rpm = lerp(this.rpm, clamp(input * 4, 0, 1), dt * 4); this.angle += this.rpm * dt * 10 * (this.keyDir < 0 ? -1 : 1); AX.loopGain('stir', this.rpm * .1);
    const inBand = Math.abs(this.rpm - this.targetRpm) < this.band;
    if (inBand) this.holdT += dt; else if (this.rpm > this.targetRpm + this.band) addInstability(dt * 8 * game.vol(), 'stirring too hard');
    this.bar.textContent = `RPM ${Math.round(this.rpm * 100)} · BLEND ${Math.round(clamp(this.holdT / this.need, 0, 1) * 100)}%`;
    if (this.holdT >= this.need && !this.ended) { this.ended = true; game.scores.stir = clamp(1 - Math.max(0, this.t - this.holdT) * 0.1, .4, 1); AX.good(); transit(game, 'heat'); }
  },
  draw() { const b = this.beaker;
    drawBeaker(b, () => { const col = avgColor(game.selected), top = b.y - b.h * 0.18;
      fillLiquid(b.x - b.w / 2, b.w, top, b.y + b.h / 2, col, col, this.t, this.rpm * 0.5, 0);
      G.save(); G.translate(b.x, b.y - b.h * 0.02); G.strokeStyle = 'rgba(255,255,255,.18)'; G.lineWidth = 2;
      for (let sN = 0; sN < 4; sN++) { G.beginPath(); for (let i = 0; i < 40; i++) { const a = this.angle * (this.keyDir < 0 ? -1 : 1) + i * .4 + sN * 1.6, rr = (6 + i * 1.6) * (1 - this.rpm * 0.2), px = Math.cos(a) * rr, py = Math.sin(a) * rr * .4; i === 0 ? G.moveTo(px, py) : G.lineTo(px, py); } G.stroke(); }
      G.fillStyle = 'rgba(4,8,6,' + (this.rpm * .5) + ')'; G.beginPath(); G.ellipse(0, 0, 10 + this.rpm * 22, 4 + this.rpm * 8, 0, 0, 7); G.fill(); G.restore();
    });
    const rodA = this.angle, rr = 40, rx = b.x + Math.cos(rodA) * rr, ry = (b.y - b.h * 0.02) + Math.sin(rodA) * rr * .4;
    G.strokeStyle = 'rgba(220,240,245,.7)'; G.lineWidth = 4; G.beginPath(); G.moveTo(rx, ry - 70); G.lineTo(rx, ry); G.stroke();
    G.fillStyle = 'rgba(220,240,245,.5)'; G.beginPath(); G.arc(rx, ry, 4, 0, 7); G.fill();
    const cx = b.x + b.w / 2 + 70, cy = b.y - b.h / 2 + 50, R = 38;
    G.strokeStyle = 'rgba(132,150,168,.25)'; G.lineWidth = 8; G.beginPath(); G.arc(cx, cy, R, Math.PI * .75, Math.PI * 2.25); G.stroke();
    const a0 = Math.PI * .75, span = Math.PI * 2.25 - a0, bs = a0 + span * (this.targetRpm - this.band), be = a0 + span * (this.targetRpm + this.band);
    G.strokeStyle = 'rgba(79,224,138,.7)'; G.beginPath(); G.arc(cx, cy, R, bs, be); G.stroke();
    const na = a0 + span * this.rpm; G.strokeStyle = Math.abs(this.rpm - this.targetRpm) < this.band ? '#4fe08a' : this.rpm > this.targetRpm ? '#ff4a5b' : '#5fd0e0'; G.lineWidth = 3; G.beginPath(); G.moveTo(cx, cy); G.lineTo(cx + Math.cos(na) * R, cy + Math.sin(na) * R); G.stroke();
    G.fillStyle = '#6f8a7c'; G.font = '8px monospace'; G.textAlign = 'center'; G.fillText('RPM', cx, cy + R + 14);
  },
};

STAGES.heat = {
  enter() { const g = game; this.t = 0; this.dur = 15; this.level = .5; this.vel = 0; this.hold = false; this.inBand = 0; this.ended = false;
    const d = g.diff(); this.gravity = 0.95 + d * .05; this.push = 1.9 + d * .05; this.bandHalf = clamp(.16 - d * .008, .05, .16); this.bandSpeed = .2 + d * .05;
    this.beaker = { x: W / 2, y: H * 0.48, w: 120, h: 230 }; this.bubbles = []; this.heatS = 0;
    g.lab.ticker('STABILIZE — hold to heat, keep the reagent in the green band. let it run away and it bites.');
    this.bar = mkEl('position:absolute;left:50%;bottom:22px;transform:translateX(-50%);color:#6f8a7c;font-size:9px;letter-spacing:2px;text-transform:uppercase;pointer-events:none');
    AX.loop('burner', { freq: 70, type: 'sawtooth', gain: .04, filt: 520, tremRate: 11, tremDepth: .35 });
  },
  exit() { AX.stop('burner'); },
  down() { this.hold = true; }, up() { this.hold = false; },
  key(e) { if (e.code === 'Space') { e.preventDefault(); this.hold = true; } }, keyup(e) { if (e.code === 'Space') this.hold = false; },
  band() { const c = .5 + (.5 - this.bandHalf) * .8 * Math.sin(this.t * this.bandSpeed * Math.PI * 2); return clamp(c, this.bandHalf, 1 - this.bandHalf); },
  update(dt) { this.t += dt; this.vel += (this.hold ? this.push : -this.gravity) * dt; this.vel *= Math.pow(.06, dt); this.level = clamp(this.level + this.vel * dt, 0, 1);
    this.heatS += ((this.hold ? 1 : 0) - this.heatS) * Math.min(1, dt * 6); AX.loopGain('burner', .04 + this.heatS * .1);
    const c = this.band(), inb = Math.abs(this.level - c) <= this.bandHalf; if (inb) this.inBand += dt;
    if (!inb) addInstability(dt * 5 * game.vol() * (Math.abs(this.level - c) / this.bandHalf), null);
    if (Math.random() < this.heatS * .6 + .05) this.bubbles.push({ x: rnd(1, -1), y: 0, r: rnd(3, 1), spd: rnd(1.4, .6) });
    this.bubbles.forEach(bl => bl.y += bl.spd * dt); this.bubbles = this.bubbles.filter(bl => bl.y < 1);
    this.bar.textContent = `STABLE ${Math.round(this.inBand / Math.max(.001, this.t) * 100)}% · ${Math.max(0, this.dur - this.t).toFixed(1)}s`;
    if (this.t >= this.dur && !this.ended) { this.ended = true; game.scores.heat = clamp(this.inBand / this.dur, 0, 1); addInstability((1 - game.scores.heat) * 8 * game.vol(), 'unstable reaction'); if (!game.blown) transit(game, 'rhythm'); }
  },
  draw() { const b = this.beaker, base = b.y + b.h / 2, ly = base - this.level * (b.h * 0.7), slosh = clamp(Math.abs(this.vel) * 0.5, 0, 1);
    drawBurner(b, this.heatS, this.t);
    drawBeaker(b, () => { const c = this.band(), inb = Math.abs(this.level - c) <= this.bandHalf, col = inb ? '#4fe08a' : (this.level > c ? '#e0b64f' : '#e0644f');
      fillLiquid(b.x - b.w / 2, b.w, ly, base, col, col, this.t, slosh, this.heatS);
      const bt = base - (c + this.bandHalf) * (b.h * 0.7), bb = base - (c - this.bandHalf) * (b.h * 0.7);
      G.fillStyle = inb ? 'rgba(90,255,150,.16)' : 'rgba(90,255,150,.07)'; G.fillRect(b.x - b.w / 2, bt, b.w, bb - bt);
      G.strokeStyle = 'rgba(120,255,170,.6)'; G.setLineDash([5, 4]); G.lineWidth = 1; G.beginPath(); G.moveTo(b.x - b.w / 2, bt); G.lineTo(b.x + b.w / 2, bt); G.moveTo(b.x - b.w / 2, bb); G.lineTo(b.x + b.w / 2, bb); G.stroke(); G.setLineDash([]);
      this.bubbles.forEach(bl => { G.fillStyle = 'rgba(220,255,235,.3)'; G.beginPath(); G.arc(b.x + bl.x * b.w * .35, base - bl.y * (base - ly), bl.r, 0, 7); G.fill(); });
    });
    drawSteam(b.x, ly, this.heatS * 0.9, this.t, '210,255,225');
    G.fillStyle = '#6f8a7c'; G.font = '10px monospace'; G.textAlign = 'center'; G.fillText('STABILIZE THE REACTION', b.x, b.y - b.h / 2 - 14);
  },
};

STAGES.rhythm = {
  enter() { const g = game; this.t = 0; this.beats = []; this.done = false; this.flashT = 0; this.shake = 0;
    const bpm = 78 + g.diff() * 6; this.interval = 60 / bpm; this.window = clamp(.16 - g.diff() * .006, .06, .16); this.lead = 2.0;
    for (let i = 0; i < 8; i++) this.beats.push({ time: this.lead + i * this.interval, hit: null });
    this.beaker = { x: W / 2, y: H * 0.5, w: 150, h: 200 };
    g.lab.ticker('SET — strike SPACE on each pulse. lock the lattice. this is the part everyone rushes and ruins.');
    this.judgements = []; this.nextMetro = this.lead;
    this.readout = mkEl('position:absolute;left:50%;bottom:24px;transform:translateX(-50%);color:#6f8a7c;font-size:11px;letter-spacing:2px;text-transform:uppercase;pointer-events:none;min-width:120px;text-align:center');
    AX.loop('drone', { freq: 55, type: 'sine', gain: .05, filt: 300 });
  },
  exit() { AX.stop('drone'); },
  down() { this.strike(); }, key(e) { if (e.code === 'Space') { e.preventDefault(); this.strike(); } },
  strike() { let best = null, bd = 1; this.beats.forEach(b => { if (b.hit !== null) return; const d = Math.abs(b.time - this.t); if (d < bd) { bd = d; best = b; } });
    if (!best || bd > this.window * 2.5) { addInstability(6 * game.vol(), 'mistimed strike'); this.shake = 6; AX.bad(); this.judgements.push({ txt: 'MISS', t: this.t, col: '#ff4a5b' }); return; }
    let txt, col, score;
    if (bd < this.window * 0.5) { txt = 'PERFECT'; col = '#4fe08a'; score = 1; AX.perfect(); }
    else if (bd < this.window) { txt = 'GOOD'; col = '#5fd0e0'; score = .75; AX.good(); }
    else { txt = 'OFF'; col = '#ffb23e'; score = .4; addInstability(3 * game.vol(), null); AX.click(); }
    best.hit = score; this.judgements.push({ txt, t: this.t, col }); this.flashT = .2; this.shake = score > .7 ? 3 : 0;
  },
  update(dt) { this.t += dt; this.flashT = Math.max(0, this.flashT - dt); this.shake *= 0.85;
    this.beats.forEach(b => { if (b.hit === null && this.t > b.time + this.window * 2.5) { b.hit = 0; addInstability(5 * game.vol(), 'dropped beat'); this.judgements.push({ txt: 'MISS', t: this.t, col: '#ff4a5b' }); AX.bad(); this.shake = 5; } });
    if (this.t >= this.nextMetro && this.nextMetro < this.lead + 8 * this.interval) { AX.tick(); this.nextMetro += this.interval; }
    this.judgements = this.judgements.filter(j => this.t - j.t < .7);
    this.readout.textContent = `${this.beats.filter(b => b.hit !== null).length}/${this.beats.length}`;
    if (!this.done && this.beats.every(b => b.hit !== null)) { this.done = true; setTimeout(() => this.finish(), 700); }
  },
  finish() { game.scores.rhythm = this.beats.reduce((a, b) => a + b.hit, 0) / this.beats.length;
    if (game.mode === 'test') finalizeTest(); else resolveReal();
  },
  draw() { const b = this.beaker; G.save(); if (this.shake > .3) G.translate(rnd(this.shake, -this.shake), rnd(this.shake, -this.shake));
    drawBeaker(b, () => { const col = avgColor(game.selected), top = b.y - b.h * 0.1, glow = .6 + .4 * Math.sin(this.t * 6) + this.flashT * 3;
      fillLiquid(b.x - b.w / 2, b.w, top, b.y + b.h / 2, shade(col, 20 + this.flashT * 60), col, this.t, 0.15, clamp(glow * .3, 0, .6)); });
    const cy = b.y - b.h / 2 - 70, cx = b.x, R = 40;
    G.strokeStyle = this.flashT > 0 ? '#4fe08a' : 'rgba(120,150,140,.5)'; G.lineWidth = 3; G.beginPath(); G.arc(cx, cy, R, 0, 7); G.stroke();
    G.strokeStyle = 'rgba(79,224,138,.3)'; G.lineWidth = 1; G.beginPath(); G.arc(cx, cy, R + 6, 0, 7); G.stroke();
    this.beats.forEach(bt => { if (bt.hit !== null) return; const dt = bt.time - this.t; if (dt > this.lead || dt < -this.window * 2.5) return;
      const rr = R + clamp(dt, 0, this.lead) / this.lead * 160; G.strokeStyle = `rgba(95,208,224,${clamp(1 - dt / this.lead, .2, 1)})`; G.lineWidth = 2; G.beginPath(); G.arc(cx, cy, rr, 0, 7); G.stroke(); });
    this.beats.forEach((bt, i) => { const px = cx - 140 + i * 40, col = bt.hit === null ? '#3a4a42' : bt.hit >= 1 ? '#4fe08a' : bt.hit >= .75 ? '#5fd0e0' : bt.hit >= .4 ? '#ffb23e' : '#ff4a5b'; G.fillStyle = col; G.beginPath(); G.arc(px, cy + R + 26, 4, 0, 7); G.fill(); });
    this.judgements.forEach(j => { const a = 1 - (this.t - j.t) / .7; G.globalAlpha = a; G.fillStyle = j.col; G.font = 'bold 16px monospace'; G.textAlign = 'center'; G.fillText(j.txt, cx, cy - 30 - (1 - a) * 20); }); G.globalAlpha = 1;
    G.fillStyle = '#6f8a7c'; G.font = '9px monospace'; G.textAlign = 'center'; G.fillText('◄ STRIKE ON THE RING ►', cx, cy - 56);
    G.restore();
  },
};

// ── resolve ──────────────────────────────────────────────────────────────────
function aggScore() { const s = game.scores; const avg = (s.mix + s.pour + s.stir + s.heat + s.rhythm) / 5; return clamp(Math.round(avg * 100 - game.instability * 0.3), 0, 100); }
function resolveReal() { const score = aggScore(); game.lab.ticker('sequence complete — resolving…', ''); AX.good();
  const cb = game.onResolve; setTimeout(() => { const g = game; if (g) g.lab.close(); if (cb) cb({ score }); }, 850); }

// test-mode only: client-side catastrophe + result card (dev feel-test)
function finalizeTest() { if (!game.blown && Math.random() < catastropheChance()) { catastrophe('the final set'); return; } showResult(false); }
function catastrophe(reason) { const g = game; g.blown = true; AX.klaxon(); AX.shatter(); g.lab.flash('#ff4a5b');
  const parts = []; for (let i = 0; i < 60; i++) parts.push({ x: W / 2, y: H / 2, vx: rnd(400, -400), vy: rnd(-100, -460), life: 0, col: Math.random() < .5 ? avgColor(g.selected) : '#dfeef0' });
  let pt = performance.now();
  (function burst(now) { if (g.closed) return; const dt = (now - pt) / 1000; pt = now;
    parts.forEach(p => { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 800 * dt; G.globalAlpha = clamp(1 - p.life / 1.4, 0, 1); G.fillStyle = p.col; G.beginPath(); G.arc(p.x, p.y, rnd(3, 1), 0, 7); G.fill(); }); G.globalAlpha = 1;
    if (parts[0].life < 1.4) requestAnimationFrame(burst); })(pt);
  setTimeout(() => showResult(true), 700);
}
function computePotency() { const s = game.scores; const avg = (s.mix + s.pour + s.stir + s.heat + s.rhythm) / 5; return clamp(0.55 + avg * 0.9 - game.instability / 100 * 0.5, 0.3, 1.7); }
function showResult(blown) {
  const g = game; const potency = blown ? 0 : computePotency();
  const card = document.createElement('div');
  card.setAttribute('style', 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;background:radial-gradient(120% 90% at 50% 40%,rgba(4,8,6,.6),rgba(2,4,3,.94));pointer-events:auto');
  const rows = ['mix|MIX', 'pour|POUR', 'stir|AGITATION', 'heat|STABILITY', 'rhythm|SET'].map(r => { const [k, lbl] = r.split('|'); const p = Math.round(g.scores[k] * 100); return `<div style="display:flex;justify-content:space-between;font-size:10px;color:#6f8a7c;margin:4px 24px"><span>${lbl}</span><b style="color:${p >= 75 ? '#4fe08a' : p >= 45 ? '#ffb23e' : '#ff4a5b'}">${p}%</b></div>`; }).join('');
  card.innerHTML = `<div style="width:360px;padding:22px;background:linear-gradient(180deg,#0e1512,#070b09);border:1px solid rgba(79,224,138,.4);border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,.9)">
    <div style="font-size:19px;letter-spacing:3px;color:${blown ? '#ff4a5b' : '#4fe08a'};font-weight:bold">${blown ? 'BATCH LOST' : 'UNKNOWN COMPOUND'}</div>
    <div style="font-size:9px;letter-spacing:3px;color:#6f8a7c;text-transform:uppercase;margin:4px 0 14px">${blown ? 'CATASTROPHIC FAILURE' : (potency > 1.3 ? 'POTENT · VOLATILE' : 'TEST BATCH')}</div>
    ${rows}
    <div style="display:flex;justify-content:space-between;font-size:10px;color:#6f8a7c;margin:8px 24px 0;padding-top:8px;border-top:1px solid rgba(79,224,138,.2)"><span>POTENCY</span><b style="color:${blown ? '#ff4a5b' : '#4fe08a'}">${blown ? '—' : potency.toFixed(2) + '×'}</b></div>
    <div style="font-size:10px;color:#9db8ab;font-style:italic;margin:14px 20px">${blown ? "It's gone. Glass everywhere, and the smell will linger." : 'A clean run. On the real bench, the server decides how it lands.'}</div>
    <button class="lab-btn" style="position:static;margin-top:6px">✕ CLOSE</button></div>`;
  g.lab.ui.appendChild(card);
  card.querySelector('button').onclick = () => g.lab.close();
  AX.tone(blown ? 120 : 520, .4, { type: blown ? 'sawtooth' : 'triangle', gain: .2, to: blown ? 60 : 780 });
}

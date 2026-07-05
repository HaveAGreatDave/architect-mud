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
  drawBench, drawBeaker, drawBurner, flame, dustMotes, lightShaft, condensation, drawLabProps, drawSideTable,
  AX, mountLab, evPos,
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

// per-form carry physics (spring freq Hz) + per-sub fluidity (slosh gain)
const FORM_FREQ = { liquid: 2.0, gel: 2.1, powder: 2.4, pill: 2.8, gas: 2.3, crystal: 2.9, blotter: 3.2, paste: 1.7, leaf: 2.6 };
const FORM_FLUID = { thin: 1, oil: 1, solvent: 1, fine: .28, crystalline: .22, viscous: .55, tablet: .06, pressurized: .5, shard: .05, sheet: .04, tar: .35, dried: .08 };
// side-view drug table (far-left): drugs stand along the tabletop at y = H*0.60
function tableHomes(n) { const x0 = W * 0.06, x1 = W * 0.46, top = H * 0.60, pad = 40, usable = (x1 - x0) - pad * 2, step = n > 1 ? Math.min(58, usable / (n - 1)) : 0, first = (x0 + x1) / 2 - step * (n - 1) / 2;
  return Array.from({ length: n }, (_, i) => ({ x: first + i * step, y: top - 30 })); }
// big top warning + product-loss readout, shared by SELECT + CHARGE
function bigWarn(text, tint, alpha) {
  G.save(); G.textAlign = 'center'; G.globalAlpha = clamp(alpha, 0, 1); G.font = 'bold 27px monospace'; const y = H * 0.13;
  G.fillStyle = 'rgba(255,74,91,.4)'; G.fillText(text, W / 2 - 2, y);
  G.fillStyle = 'rgba(95,208,224,.4)'; G.fillText(text, W / 2 + 2, y);
  G.shadowColor = `rgba(${tint},.9)`; G.shadowBlur = 20; G.fillStyle = `rgb(${tint})`; G.fillText(text, W / 2, y); G.shadowBlur = 0; G.restore();
}
function drawCarryWarn(s) {
  if (s._spillT > 0) bigWarn('⚠ SPILLING — LOSING PRODUCT ⚠', '255,74,91', .7 + .3 * Math.sin(s.t * 14));
  else if (s.t < s.carefulUntil) bigWarn('⚠ CARRY IT STEADY ⚠', '255,178,62', clamp(s.carefulUntil - s.t, 0, 1));
  if (s.lost > 0) { G.save(); G.textAlign = 'center'; G.globalAlpha = .85; G.fillStyle = '#ff6a6a'; G.font = 'bold 12px monospace'; G.fillText(`PRODUCT LOST: ${Math.round(s.lost)}%`, W / 2, H * 0.13 + 26); G.restore(); }
}

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
  go(game, 'title');
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
  go(game, 'charge');
  game.raf = requestAnimationFrame(loop);
}

// dispatch may call this to force-close on nav/logout
export function closeSplice() { if (game && game.lab) game.lab.close(); }

// Live risk readout on the SELECT screen, fed by the server's splice_preview.
export function applySplicePreview(data) {
  const s = STAGES.select;
  if (!s || stage !== s || !s.risk) return;
  if (!data || !data.ok) { s.risk.textContent = ''; return; }
  const dw = data.doseWeight || 1;
  const parts = [`difficulty ${data.difficulty} · counts as ${dw} dose${dw === 1 ? '' : 's'} (overdose at ${data.odThreshold})`];
  if (data.instability >= 0.6) parts.push('⚠ HIGHLY UNSTABLE');
  else if (data.instability > 0) parts.push(`instability ${Math.round(data.instability * 100)}%`);
  for (const w of (data.warnings || [])) parts.push('⚠ ' + w);
  s.risk.textContent = parts.join('\n');
}

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
  } else if (d.form === 'gas') {
    const cw = 26, ch = 60;
    const bg = G.createLinearGradient(-cw / 2, 0, cw / 2, 0); bg.addColorStop(0, '#3a444c'); bg.addColorStop(.5, '#8a97a2'); bg.addColorStop(1, '#2a3138');
    G.fillStyle = bg; roundRect(-cw / 2, -ch / 2 + 6, cw, ch - 6, 6); G.fill();
    G.globalAlpha = .8; G.fillStyle = c; G.fillRect(-cw / 2 + 2, ch / 2 - 20, cw - 4, 14); G.globalAlpha = 1;
    G.strokeStyle = shade(c, 60); G.lineWidth = 1; G.strokeRect(-cw / 2 + 2, ch / 2 - 20, cw - 4, 14);
    G.strokeStyle = 'rgba(220,235,240,.5)'; G.lineWidth = 1.4; roundRect(-cw / 2, -ch / 2 + 6, cw, ch - 6, 6); G.stroke();
    G.fillStyle = 'rgba(255,255,255,.25)'; G.fillRect(-cw / 2 + 4, -ch / 2 + 10, 3, ch - 20);
    G.fillStyle = '#20262b'; G.fillRect(-4, -ch / 2 - 4, 8, 12); G.fillStyle = '#4a545c'; G.fillRect(-6, -ch / 2 - 6, 12, 4);
    G.save(); G.translate(0, -ch / 2 + 18);
    G.fillStyle = '#0c1114'; G.beginPath(); G.arc(0, 0, 7, 0, 7); G.fill(); G.strokeStyle = 'rgba(200,220,225,.5)'; G.lineWidth = 1; G.stroke();
    const na = -Math.PI * 0.75 + (0.5 + slosh * 0.4) * Math.PI * 1.5;
    G.strokeStyle = Math.abs(slosh) > 0.6 ? '#ff4a5b' : '#4fe08a'; G.lineWidth = 1.4; G.beginPath(); G.moveTo(0, 0); G.lineTo(Math.cos(na) * 5, Math.sin(na) * 5); G.stroke(); G.restore();
    if (Math.abs(slosh) > 0.5) { G.globalAlpha = Math.min(.4, Math.abs(slosh) * .3); G.fillStyle = shade(c, 80); for (let i = 0; i < 3; i++) { G.beginPath(); G.arc(rnd(6, -6), -ch / 2 - 8 - i * 4, 2 + i, 0, 7); G.fill(); } G.globalAlpha = 1; }
  } else if (d.form === 'crystal') {
    G.fillStyle = 'rgba(180,190,200,.3)'; G.beginPath(); G.ellipse(0, 14, 22, 7, 0, 0, 7); G.fill();
    G.strokeStyle = 'rgba(210,220,230,.4)'; G.lineWidth = 1; G.stroke();
    const cg = G.createLinearGradient(0, -24, 0, 14); cg.addColorStop(0, shade(c, 80)); cg.addColorStop(.5, c); cg.addColorStop(1, shade(c, -30));
    G.fillStyle = cg; G.beginPath(); G.moveTo(0, -26); G.lineTo(-13, -2); G.lineTo(-7, 14); G.lineTo(7, 14); G.lineTo(13, -2); G.closePath(); G.fill();
    G.strokeStyle = 'rgba(255,255,255,.5)'; G.lineWidth = 1; G.beginPath(); G.moveTo(0, -26); G.lineTo(-7, 14); G.moveTo(0, -26); G.lineTo(7, 14); G.moveTo(-13, -2); G.lineTo(13, -2); G.stroke();
    G.shadowColor = c; G.shadowBlur = hi || inCradle ? 18 : 10; G.strokeStyle = shade(c, 50); G.beginPath(); G.moveTo(0, -26); G.lineTo(-13, -2); G.lineTo(-7, 14); G.lineTo(7, 14); G.lineTo(13, -2); G.closePath(); G.stroke(); G.shadowBlur = 0;
    G.fillStyle = 'rgba(255,255,255,.8)'; G.beginPath(); G.arc(-3, -8, 1.5, 0, 7); G.fill();
    G.fillStyle = 'rgba(255,255,255,.5)'; G.beginPath(); G.arc(4, 2, 1, 0, 7); G.fill();
  } else if (d.form === 'blotter') {
    const bw = 44, bh = 44, cell = bw / 4;
    G.fillStyle = 'rgba(232,227,212,.92)'; roundRect(-bw / 2, -bh / 2, bw, bh, 2); G.fill();
    for (let r = 0; r < 4; r++) for (let cc = 0; cc < 4; cc++) { const px = -bw / 2 + cc * cell, py = -bh / 2 + r * cell;
      G.globalAlpha = .85; G.fillStyle = ((r + cc) % 2) ? shade(c, 10) : shade(c, -15); G.fillRect(px + 1, py + 1, cell - 2, cell - 2); G.globalAlpha = 1;
      G.fillStyle = shade(c, 60); G.beginPath(); G.arc(px + cell / 2, py + cell / 2, 1.4, 0, 7); G.fill(); }
    G.strokeStyle = 'rgba(120,110,90,.4)'; G.lineWidth = .5; G.setLineDash([1, 2]);
    for (let i = 1; i < 4; i++) { G.beginPath(); G.moveTo(-bw / 2 + i * cell, -bh / 2); G.lineTo(-bw / 2 + i * cell, bh / 2); G.moveTo(-bw / 2, -bh / 2 + i * cell); G.lineTo(bw / 2, -bh / 2 + i * cell); G.stroke(); }
    G.setLineDash([]); G.strokeStyle = 'rgba(120,110,90,.5)'; G.lineWidth = 1; roundRect(-bw / 2, -bh / 2, bw, bh, 2); G.stroke();
  } else if (d.form === 'paste') {
    G.fillStyle = 'rgba(200,195,180,.25)'; roundRect(-24, -18, 48, 36, 4); G.fill();
    const tg = G.createRadialGradient(-5, -5, 3, 0, 3, 24); tg.addColorStop(0, shade(c, 30)); tg.addColorStop(.6, shade(c, -40)); tg.addColorStop(1, shade(c, -70));
    G.fillStyle = tg; blob(0, 0, 22, 15, t * 0.6 + slosh * 1.5); G.fill();
    G.fillStyle = 'rgba(255,255,255,.3)'; G.beginPath(); G.ellipse(-5, -5, 7, 3, -0.4, 0, 7); G.fill();
    G.fillStyle = 'rgba(255,255,255,.15)'; G.beginPath(); G.ellipse(6, 3, 4, 2, 0.3, 0, 7); G.fill();
    G.strokeStyle = 'rgba(200,195,180,.4)'; G.lineWidth = 1; roundRect(-24, -18, 48, 36, 4); G.stroke();
  } else if (d.form === 'leaf') {
    const bw = 42, bh = 56;
    G.fillStyle = 'rgba(200,220,230,.10)'; roundRect(-bw / 2, -bh / 2, bw, bh, 4); G.fill();
    G.save(); roundRect(-bw / 2 + 3, -bh / 2 + 10, bw - 6, bh - 16, 3); G.clip();
    const shift = slosh * 5;
    for (let i = 0; i < 22; i++) { G.save(); G.translate(-bw / 2 + 5 + Math.random() * (bw - 10) - shift * 0.3, bh / 2 - 5 - Math.random() * 24); G.rotate(Math.random() * 3);
      G.fillStyle = i % 3 ? shade(c, 10) : shade(c, -24); G.beginPath(); G.moveTo(0, -2.5); G.lineTo(2, 0); G.lineTo(0, 2.5); G.lineTo(-2, 0); G.closePath(); G.fill(); G.restore(); }
    for (let k = 0; k < 2; k++) { G.save(); G.translate(-7 + k * 14, 8); G.rotate(0.4 - k * 0.8);
      G.fillStyle = shade(c, k ? 24 : -8); G.beginPath(); G.ellipse(0, 0, 3, 8, 0, 0, 7); G.fill();
      G.strokeStyle = shade(c, -30); G.lineWidth = 0.6; G.beginPath(); G.moveTo(0, -7); G.lineTo(0, 7); G.stroke(); G.restore(); }
    G.restore();
    G.strokeStyle = 'rgba(210,230,240,.4)'; G.lineWidth = 1.2; roundRect(-bw / 2, -bh / 2, bw, bh, 4); G.stroke();
    G.fillStyle = 'rgba(232,242,246,.7)'; G.fillRect(-bw / 2, -bh / 2, bw, 7);
    G.strokeStyle = 'rgba(120,140,150,.5)'; G.lineWidth = 1; for (let i = -bw / 2 + 2; i < bw / 2; i += 3) { G.beginPath(); G.moveTo(i, -bh / 2); G.lineTo(i, -bh / 2 + 6); G.stroke(); }
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
  if (phys.noName) return; // scattered title-screen packages carry no label
  G.textAlign = 'center';
  G.fillStyle = inCradle ? '#4fe08a' : (hi ? '#dffbe9' : '#7f9a8c'); G.font = (inCradle ? 'bold ' : '') + '10px monospace';
  G.fillText((d.known ?? 1) > .4 ? d.name : '???', x, y + 46);
  if (inCradle) { const idx = game.selected.indexOf(d); G.fillStyle = '#4fe08a'; G.font = 'bold 9px monospace'; G.fillText(idx === 0 ? '◆ BASE' : '+ GRAFT', x, y + 58); }
}

// ══ STAGES ═══════════════════════════════════════════════════════════════════
const STAGES = {};

// TITLE — the bench powers up with the player's drugs scattered across it, then
// BEGIN drops into the selection screen. Pure client-side intro (no server hit).
STAGES.title = {
  enter() {
    const g = game; this.t = 0; this.pw = 0; this.spin = 0; this.titleA = 0; this.flick = 1; this.btnShown = false; this.ready = false; this._begun = false;
    this.quip = ['this bench has killed better chemists than you.', 'ventilation nominal. conscience optional.', 'everything on this table is technically evidence.', 'mind the third beaker. it bites.'][Math.floor(rnd(4))];
    const homes = tableHomes(g.drugs.length);
    this.scatter = g.drugs.map((d, i) => ({ d, x: homes[i].x, y: homes[i].y, bob: rnd(7) }));
    g.lab.setTop('SPLICE BENCH'); g.lab.ticker('');
    AX.loop('hood', { freq: 54, type: 'sawtooth', gain: 0, filt: 320, tremRate: 7, tremDepth: .25 });
  },
  exit() { AX.stop('hood'); },
  showBtn() { AX.good(); this.ready = true; game.lab.ticker('the reagents are all here — CLICK or SPACE to begin. pick your poison, two at least.'); },
  begin() { if (!this.ready || this._begun) return; this._begun = true; AX.click(); AX.stop('hood'); transit(game, 'select'); },
  down() { this.begin(); },
  key(e) { if (e.code === 'Space' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this.begin(); } },
  update(dt) { this.t += dt; this.spin += dt * (1.1 + (1 - this.pw) * 3);
    const target = clamp((this.t - 0.2) / 1.6, 0, 1); this.pw = lerp(this.pw, target, dt * 3);
    this.flick = this.pw > 0.96 ? 1 : (Math.random() < 0.10 ? rnd(1, .25) : lerp(this.flick, 1, dt * 8));
    this.titleA = lerp(this.titleA, this.pw > 0.35 ? 1 : 0, dt * 3);
    AX.loopGain('hood', .06 * this.pw + .02);
    if (!this.btnShown && this.pw > 0.985) { this.btnShown = true; this.showBtn(); }
  },
  draw() {
    const cx = W / 2, benchY = H * 0.62, pw = this.pw, fl = this.flick;
    drawLabProps(this.t, pw);
    const hw = 360, hh = 196, hx = cx - hw / 2, hy = 44;
    const win = G.createLinearGradient(0, hy, 0, hy + hh); win.addColorStop(0, `rgba(20,60,44,${.5 * pw})`); win.addColorStop(1, `rgba(6,20,14,${.6 * pw})`);
    G.fillStyle = win; G.fillRect(hx, hy, hw, hh);
    G.globalAlpha = pw * .5; G.strokeStyle = 'rgba(8,18,14,.9)'; G.lineWidth = 3;
    for (let i = 0; i < 5; i++) { const tx = hx + 42 + i * 69; G.beginPath(); G.moveTo(tx, hy); G.lineTo(tx + Math.sin(this.t + i) * 4, hy + 48 + ((i * 13) % 42)); G.stroke(); }
    G.globalAlpha = 1;
    condensation(hx + 8, hy + 8, hw - 16, hh - 16, 3, Math.floor(pw * 40));
    G.strokeStyle = `rgba(90,110,120,${.5 + .3 * pw})`; G.lineWidth = 4; G.strokeRect(hx, hy, hw, hh);
    G.strokeStyle = 'rgba(60,80,88,.6)'; G.lineWidth = 2; G.beginPath(); G.moveTo(hx, hy + hh * .5); G.lineTo(hx + hw, hy + hh * .5); G.stroke();
    lightShaft(cx, 70, 320, benchY + 30, '130,225,175', .06 * pw * fl + .015);
    G.fillStyle = '#1a2024'; G.fillRect(cx - 40, 8, 80, 14);
    G.save(); G.shadowColor = 'rgba(120,255,190,.9)'; G.shadowBlur = 30 * pw * fl; G.fillStyle = `rgba(190,255,225,${.7 * pw * fl})`; G.fillRect(cx - 34, 20, 68, 5); G.restore();
    dustMotes(this.t, 46, '150,225,185');
    drawSideTable(W * 0.06, W * 0.46, H * 0.60);
    this.drawFlask(cx + 120, benchY + 16, pw);
    this.drawCondenser(cx + 250, benchY - 8, pw);
    this.scatter.forEach(s => drawPackage(s.d, s.x, s.y + Math.sin(this.t * 1.2 + s.bob) * 1, false, false, this.t * .4 + s.bob, { tilt: 0, slosh: 0, noName: true }));
    G.save(); G.globalAlpha = this.titleA; G.textAlign = 'center'; G.font = 'bold 38px monospace';
    G.fillStyle = 'rgba(255,74,91,.45)'; G.fillText('SPLICE BENCH', cx - 2, H * 0.33 + 12);
    G.fillStyle = 'rgba(95,208,224,.45)'; G.fillText('SPLICE BENCH', cx + 2, H * 0.33 + 12);
    G.shadowColor = 'rgba(79,224,138,.8)'; G.shadowBlur = 22 * pw; G.fillStyle = '#dffbe9'; G.fillText('SPLICE BENCH', cx, H * 0.33 + 12); G.shadowBlur = 0;
    G.font = '11px monospace'; G.fillStyle = 'rgba(159,199,172,.7)'; G.fillText('CHIMERA-9 · GENESPLICER', cx, H * 0.33 + 32);
    G.globalAlpha = this.titleA * .7 * (0.6 + 0.4 * Math.sin(this.t * 2)); G.fillStyle = '#7f9a8c'; G.font = 'italic 11px monospace';
    G.fillText(this.quip, cx, benchY - 16); G.restore();
    if (this.ready) { G.save(); G.globalAlpha = .55 + .45 * Math.sin(this.t * 4); G.fillStyle = '#4fe08a'; G.font = 'bold 13px monospace'; G.textAlign = 'center'; G.shadowColor = 'rgba(79,224,138,.7)'; G.shadowBlur = 12; G.fillText('▶ CLICK or SPACE to begin', cx, H * 0.44); G.restore(); }
  },
  drawFlask(x, y, pw) {
    G.strokeStyle = 'rgba(80,96,104,.7)'; G.lineWidth = 4; G.beginPath(); G.moveTo(x - 30, y + 40); G.lineTo(x - 30, y - 70); G.stroke();
    G.fillStyle = 'rgba(70,84,92,.8)'; G.fillRect(x - 46, y + 38, 50, 6);
    G.strokeStyle = 'rgba(90,108,116,.7)'; G.lineWidth = 3; G.beginPath(); G.moveTo(x - 30, y - 16); G.lineTo(x, y - 16); G.stroke();
    const r = 26;
    G.save(); G.beginPath(); G.arc(x, y, r, 0, 7); G.rect(x - 5, y - r - 22, 10, 24); G.clip();
    const lvl = y - 4; const fg = G.createLinearGradient(0, lvl, 0, y + r); fg.addColorStop(0, `rgba(120,240,170,${pw})`); fg.addColorStop(1, `rgba(20,90,54,${pw})`);
    G.fillStyle = fg; G.fillRect(x - r, lvl, r * 2, r * 2);
    for (let i = 0; i < 6; i++) { const bx = x + Math.sin(this.t * 2 + i * 2) * 10, by = y + r - ((this.t * 30 + i * 14) % Math.max(1, (y + r - lvl))); G.fillStyle = `rgba(210,255,230,${.3 * pw})`; G.beginPath(); G.arc(bx, by, 1.6, 0, 7); G.fill(); }
    G.restore();
    G.strokeStyle = `rgba(200,240,235,${.5 + .3 * pw})`; G.lineWidth = 2; G.beginPath(); G.arc(x, y, r, 0, 7); G.stroke(); G.strokeRect(x - 5, y - r - 22, 10, 22);
    G.save(); G.shadowColor = 'rgba(120,255,180,.8)'; G.shadowBlur = 20 * pw; G.strokeStyle = `rgba(120,255,180,${.3 * pw})`; G.beginPath(); G.arc(x, y, r, 0, 7); G.stroke(); G.restore();
    drawSteam(x, y - r - 18, pw * .7, this.t, '200,255,220');
    G.save(); G.globalCompositeOperation = 'lighter'; flame(x, y + r + 30, 7, 20 + 8 * Math.sin(this.t * 10), Math.sin(this.t * 7) * 2, `rgba(120,180,255,${.6 * pw})`, 8); flame(x, y + r + 30, 4, 12, 0, `rgba(255,200,120,${.5 * pw})`, 6); G.restore();
  },
  drawCondenser(x, y, pw) {
    G.save(); G.translate(x, y); G.rotate(0.5);
    G.fillStyle = `rgba(90,150,200,${.12 * pw})`; roundRect(-12, -70, 24, 140, 8); G.fill();
    G.globalAlpha = pw * .3; G.fillStyle = '#3a7ac0'; roundRect(-10, -66, 20, 132, 6); G.fill(); G.globalAlpha = 1;
    G.strokeStyle = `rgba(150,210,235,${.5 * pw})`; G.lineWidth = 2.5; G.beginPath();
    for (let i = 0; i <= 40; i++) { const p = i / 40, yy = -64 + p * 128, xx = Math.sin(p * Math.PI * 7) * 7; i === 0 ? G.moveTo(xx, yy) : G.lineTo(xx, yy); } G.stroke();
    G.strokeStyle = `rgba(180,220,240,${.4 + .3 * pw})`; G.lineWidth = 2; roundRect(-12, -70, 24, 140, 8); G.stroke();
    G.restore();
  },
};

STAGES.select = {
  enter() {
    const g = game; const homes = tableHomes(g.drugs.length);
    this.pkgs = g.drugs.map((d, i) => { const hx = homes[i].x, hy = homes[i].y, w = 2 * Math.PI * (FORM_FREQ[d.form] || 2.2), k = w * w, c = 2 * 0.62 * w;
      return { d, home: { x: hx, y: hy }, x: hx, y: hy, vx: 0, vy: 0, pvx: 0, tilt: 0, slosh: 0, sloshV: 0, held: false, inCradle: false, gdx: 0, gdy: 0, k, c, fluid: FORM_FLUID[d.sub] ?? .3, spill: 0, warn: 0 }; });
    this.cradle = { x: W * 0.73, y: H * 0.60, r: 58 };
    this.drag = null; this.pressP = null; this.pressT = 0; this.moved = false; this.hover = null; this.t = 0; this.drips = [];
    this.everGrabbed = false; this.carefulUntil = 0; this._spillT = 0; this._alarmT = 0; this.lost = 0;
    this.mkBtns(); g.selected = [];
    g.lab.ticker('drag a drug from the table into the reaction cradle. carry it steady. tap one to read its label.');
    AX.loop('hood', { freq: 60, type: 'sawtooth', gain: .03, filt: 340, tremRate: 7, tremDepth: .3 });
  },
  exit() { AX.stop('hood'); game.lab.canvas.style.cursor = 'default'; },
  mkBtns() {
    this.splice = mkBtn('SPLICE ▶', 'right:22px;bottom:44px'); this.splice.disabled = true;
    this.splice.onclick = () => { if (game.selected.length >= 2) { AX.confirm(); this.commit(); } };
    this.clr = mkBtn('CLEAR', 'right:150px;bottom:44px', 'ghost');
    this.clr.onclick = () => { AX.click(); this.pkgs.forEach(p => p.inCradle = false); game.selected = []; this.sync(); };
    this.hint = mkEl('position:absolute;left:50%;top:40px;transform:translateX(-50%);color:#6f8a7c;font-size:9px;letter-spacing:1px;text-transform:uppercase;pointer-events:none;text-align:center;width:70%');
    this.risk = mkEl('position:absolute;left:50%;top:58px;transform:translateX(-50%);color:#c9a06a;font-size:9px;letter-spacing:.5px;pointer-events:none;text-align:center;width:80%;white-space:pre-line;line-height:1.5');
  },
  sync() { const n = game.selected.length; this.splice.disabled = n < 2;
    this.hint.textContent = n ? `${game.selected[0].name} base${n > 1 ? ` · ${n - 1} graft${n - 1 === 1 ? '' : 's'}` : ''} — ${n >= 2 ? 'press SPLICE ▶ (or SPACE)' : 'drop one more'}` : 'drag two+ drugs into the cradle · tap to read · C clears';
    // Live risk telegraph before you commit — server's authoritative composeSplice math.
    if (game.mode !== 'test' && n >= 2) {
      const base = game.selected[0].drug, grafts = [];
      for (let i = 1; i < n; i++) for (const blk of Object.keys(game.selected[i].blocks || {})) grafts.push({ drug: game.selected[i].drug, block: blk });
      sendCmdSilent('splicepreview ' + b64({ base, grafts }));
    } else if (this.risk) this.risk.textContent = '';
  },
  commit() {
    const sel = game.selected.slice();
    _stash = { selection: sel, instability: game.instability };
    if (game.mode === 'test') { transit(game, 'charge'); return; }
    const base = sel[0].drug, grafts = [];
    for (let i = 1; i < sel.length; i++) for (const blk of Object.keys(sel[i].blocks || {})) grafts.push({ drug: sel[i].drug, block: blk });
    sendCmdSilent('splicebegin ' + b64({ base, grafts, name: '' }));
    game.lab.close();
  },
  topAt(p) { for (let i = this.pkgs.length - 1; i >= 0; i--) { const k = this.pkgs[i]; if (Math.hypot(p.x - k.x, p.y - k.y) < 44) return k; } return null; },
  move(p) { if (this.drag && !this.moved && Math.hypot(p.x - this.pressP.x, p.y - this.pressP.y) > 6) this.moved = true;
    this.hover = this.drag || this.topAt(p); game.lab.canvas.style.cursor = this.hover ? (this.drag ? 'grabbing' : 'grab') : 'default'; },
  down(p) { const k = this.topAt(p); if (!k) { hideLabel(); return; }
    this.drag = k; k.held = true; k.gdx = k.x - p.x; k.gdy = k.y - p.y; this.pressP = { x: p.x, y: p.y }; this.pressT = this.t; this.moved = false;
    this.pkgs.splice(this.pkgs.indexOf(k), 1); this.pkgs.push(k);
    if (k.inCradle) { k.inCradle = false; game.selected = game.selected.filter(d => d !== k.d); this.sync(); }
    AX.clink(); if (!this.everGrabbed) { this.everGrabbed = true; this.carefulUntil = this.t + 3.5; } },
  up() { const k = this.drag; if (!k) return; this.drag = null; k.held = false;
    if (!this.moved && (this.t - this.pressT) < 0.25) { if (_labelFor === k.d && _labelEl) hideLabel(); else showLabel(k.d, k.home.x, k.home.y); return; }
    if (Math.hypot(k.x - this.cradle.x, k.y - this.cradle.y) < this.cradle.r + 12) {
      if (game.selected.length >= 4 && !game.selected.includes(k.d)) { game.lab.ticker("cradle's full. four is already ambitious.", 'a'); AX.bad(); }
      else { k.inCradle = true; if (!game.selected.includes(k.d)) game.selected.push(k.d); AX.drop(); this.sync(); }
    } else AX.tick();
    hideLabel(); },
  key(e) { if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); if (game.selected.length >= 2) { AX.confirm(); this.commit(); } } else if (e.key === 'c' || e.key === 'C') { AX.click(); this.pkgs.forEach(p => p.inCradle = false); game.selected = []; this.sync(); } },
  spillAlarm() { this._spillT = 0.35; if (this.t - this._alarmT > 0.55) { AX.alarm(); this._alarmT = this.t; } },
  update(dt) { this.t += dt; this._spillT = Math.max(0, this._spillT - dt); const cr = this.cradle, inC = this.pkgs.filter(p => p.inCradle);
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
      const speed = Math.hypot(p.vx, p.vy);
      if (this.drag === p && p.d.form === 'gas' && speed > 480) { p.warn = 1; p.spill += dt * (speed / 600); this.spillAlarm();
        if (Math.random() < 0.4) this.drips.push({ x: p.x + rnd(10, -10), y: p.y - 24, vy: -55, life: 0, col: shade(p.d.color, 80) });
        if (p.spill > 1.2) { p.spill = 0; this.lost += 4; addInstability(5, "the canister hisses — you're bleeding pressure."); AX.bad(); }
      } else if (this.drag === p && p.fluid > 0.7 && Math.abs(p.slosh) > 0.95) { p.warn = 1; p.spill += dt * Math.abs(p.slosh); this.spillAlarm();
        if (Math.random() < 0.35) this.drips.push({ x: p.x + rnd(15, -15), y: p.y + 12, vy: 50, life: 0, col: p.d.color });
        if (p.spill > 1.3) { p.spill = 0; this.lost += 4; addInstability(6, 'you slopped it — you just lost product.'); AX.bad(); }
      } else { p.warn = lerp(p.warn, 0, dt * 4); p.spill = Math.max(0, p.spill - dt * 0.5); }
    });
    this.drips.forEach(d => { d.life += dt; d.y += d.vy * dt; d.vy += 400 * dt; }); this.drips = this.drips.filter(d => d.life < 0.6);
  },
  draw() { const cr = this.cradle;
    drawSideTable(W * 0.06, W * 0.46, H * 0.60);
    const pulse = .5 + .5 * Math.sin(this.t * 3);
    const cg = G.createRadialGradient(cr.x, cr.y, 6, cr.x, cr.y, cr.r + 34); cg.addColorStop(0, `rgba(79,224,138,${.13 + pulse * .1})`); cg.addColorStop(1, 'rgba(79,224,138,0)');
    G.fillStyle = cg; G.beginPath(); G.ellipse(cr.x, cr.y, cr.r + 34, cr.r * .62, 0, 0, 7); G.fill();
    G.strokeStyle = 'rgba(120,150,150,.5)'; G.lineWidth = 3; G.beginPath(); G.ellipse(cr.x, cr.y + 4, cr.r * .78, cr.r * .36, 0, 0.1, Math.PI - 0.1, false); G.stroke();
    G.strokeStyle = 'rgba(79,224,138,.4)'; G.setLineDash([7, 6]); G.lineWidth = 1.6; G.beginPath(); G.ellipse(cr.x, cr.y, cr.r, cr.r * .5, 0, 0, 7); G.stroke(); G.setLineDash([]);
    G.fillStyle = 'rgba(111,138,124,.7)'; G.font = '9px monospace'; G.textAlign = 'center'; G.fillText('REACTION CRADLE', cr.x, cr.y + cr.r * .5 + 18);
    this.drips.forEach(d => { G.globalAlpha = 1 - d.life / 0.6; G.fillStyle = d.col; G.beginPath(); G.arc(d.x, d.y, 2.2, 0, 7); G.fill(); }); G.globalAlpha = 1;
    this.pkgs.forEach(p => { const groundY = p.inCradle ? cr.y + 26 : H * 0.60, lift = clamp((groundY - p.y) / 120, 0, 1);
      G.save(); G.globalAlpha = .42 * (1 - lift * .5); G.fillStyle = '#000'; G.beginPath(); G.ellipse(p.x, groundY, 20 + lift * 8, 5, 0, 0, 7); G.fill(); G.restore();
      drawPackage(p.d, p.x, p.y, p.inCradle, this.hover === p || this.drag === p, this.t, { tilt: p.tilt, slosh: p.slosh, warn: p.warn, held: this.drag === p }); });
    drawCarryWarn(this);
  },
};

// CHARGE — carry each chosen drug from the side table to the POUR ZONE and hold
// it steady to decant. Jostle it while carrying and it slops (drips + lost product).
STAGES.charge = {
  enter() {
    const g = game; this.t = 0; this.hover = null; this.drag = null; this.fill = 0; this.pouredCount = 0; this.drips = []; this._done = false;
    this.everGrabbed = false; this.carefulUntil = 0; this._spillT = 0; this._alarmT = 0; this.lost = 0;
    this.beaker = { x: W * 0.73, y: H * 0.52, w: 140, h: 200 };
    this.zone = { x: this.beaker.x, y: this.beaker.y - this.beaker.h / 2 - 34, r: 46 };
    const homes = tableHomes(g.selected.length);
    this.cans = g.selected.map((d, i) => { const hx = homes[i].x, hy = homes[i].y, w = 2 * Math.PI * (FORM_FREQ[d.form] || 2.2), k = w * w, c = 2 * 0.62 * w;
      return { d, home: { x: hx, y: hy }, x: hx, y: hy, vx: 0, vy: 0, pvx: 0, tilt: 0, slosh: 0, sloshV: 0, held: false, gdx: 0, gdy: 0, k, c, fluid: FORM_FLUID[d.sub] ?? .3, poured: 0, done: false, spill: 0, warn: 0, pourSfx: false }; });
    g.lab.ticker('CHARGE — carry each drug from the table to the POUR ZONE and hold it steady to decant. jostle it and it slops.');
    this.hint = mkEl('position:absolute;left:50%;top:40px;transform:translateX(-50%);color:#6f8a7c;font-size:9px;letter-spacing:2px;text-transform:uppercase;pointer-events:none');
  },
  exit() { AX.pour(false); game.lab.canvas.style.cursor = 'default'; },
  topAt(p) { for (let i = this.cans.length - 1; i >= 0; i--) { const k = this.cans[i]; if (!k.done && Math.hypot(p.x - k.x, p.y - k.y) < 44) return k; } return null; },
  move(p) { this.hover = this.drag || this.topAt(p); game.lab.canvas.style.cursor = this.hover ? (this.drag ? 'grabbing' : 'grab') : 'default'; },
  down(p) { const k = this.topAt(p); if (!k) return; this.drag = k; k.held = true; k.gdx = k.x - p.x; k.gdy = k.y - p.y; this.cans.splice(this.cans.indexOf(k), 1); this.cans.push(k);
    AX.clink(); if (!this.everGrabbed) { this.everGrabbed = true; this.carefulUntil = this.t + 3.5; } },
  up() { const k = this.drag; if (!k) return; this.drag = null; k.held = false; if (k.pourSfx) { k.pourSfx = false; AX.pour(false); } },
  spillAlarm() { this._spillT = 0.35; if (this.t - this._alarmT > 0.55) { AX.alarm(); this._alarmT = this.t; } },
  update(dt) { this.t += dt; this._spillT = Math.max(0, this._spillT - dt); const z = this.zone;
    this.cans.forEach(p => { if (p.done) return;
      let tx, ty; if (this.drag === p) { tx = ptr.x + p.gdx; ty = ptr.y + p.gdy; } else { tx = p.home.x; ty = p.home.y; }
      const ax = (tx - p.x) * p.k - p.vx * p.c, ay = (ty - p.y) * p.k - p.vy * p.c; p.vx += ax * dt; p.vy += ay * dt;
      const spd = Math.hypot(p.vx, p.vy); if (spd > 1000) { p.vx *= 1000 / spd; p.vy *= 1000 / spd; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const dax = p.vx - p.pvx; p.pvx = p.vx; p.sloshV += dax * p.fluid * 0.6; p.sloshV += (-p.slosh * 38 - p.sloshV * 3.6) * dt; p.slosh = clamp(p.slosh + p.sloshV * dt, -1.5, 1.5);
      const inZone = Math.hypot(p.x - z.x, p.y - z.y) < z.r, steady = spd < 130 && Math.abs(p.slosh) < 0.55;
      if (this.drag === p && inZone && steady) {
        p.tilt = lerp(p.tilt, -0.7, dt * 4); p.poured = clamp(p.poured + dt * 0.7, 0, 1); this.fill = this.pouredFill();
        if (!p.pourSfx) { p.pourSfx = true; AX.pour(true); }
        if (p.poured >= 1 && !p.done) { p.done = true; this.pouredCount++; AX.pour(false); AX.drop(); this.drag = null; p.held = false; }
      } else {
        p.tilt = lerp(p.tilt, clamp(-p.vx * 0.0016, -0.42, 0.42), dt * 9);
        if (p.pourSfx) { p.pourSfx = false; AX.pour(false); }
        if (this.drag === p) { const hazard = p.d.form === 'gas' ? spd > 480 : Math.abs(p.slosh) > 1.0;
          if (hazard) { p.warn = 1; p.spill += dt; this.spillAlarm();
            if (Math.random() < 0.3) this.drips.push({ x: p.x + rnd(12, -12), y: p.y + (p.d.form === 'gas' ? -22 : 12), vy: p.d.form === 'gas' ? -50 : 60, life: 0, col: p.d.form === 'gas' ? shade(p.d.color, 80) : p.d.color });
            if (p.spill > 1.0) { p.spill = 0; this.lost += 4; addInstability(5 * game.vol(), 'you slopped it — lost product'); AX.bad(); }
          } else p.warn = lerp(p.warn, 0, dt * 4);
        } else p.warn = lerp(p.warn, 0, dt * 4);
      }
    });
    this.drips.forEach(d => { d.life += dt; d.y += d.vy * dt; d.vy += 400 * dt; }); this.drips = this.drips.filter(d => d.life < 0.6);
    this.hint.textContent = `${this.pouredCount} / ${game.selected.length} charged`;
    if (this.pouredCount >= game.selected.length && !this._done) { this._done = true; game._charged = true; AX.good(); game.lab.ticker('charged. into the mix.'); setTimeout(() => { if (game && !game.closed) transit(game, 'mix'); }, 500); }
  },
  pouredFill() { let s = 0; this.cans.forEach(p => s += p.poured); return clamp(s / Math.max(1, game.selected.length), 0, 1); },
  chargeColor() { const ds = this.cans.filter(c => c.poured > 0.02).map(c => c.d); return avgColor(ds.length ? ds : game.selected); },
  draw() { const b = this.beaker, z = this.zone;
    drawSideTable(W * 0.06, W * 0.46, H * 0.60);
    drawBeaker(b, () => { if (this.fill > 0.001) { const col = this.chargeColor(), base = b.y + b.h / 2, top = base - (b.h * 0.66) * this.fill; fillLiquid(b.x - b.w / 2, b.w, top, base, col, col, this.t, 0.12, 0.15); } });
    const anyIn = this.drag && Math.hypot(this.drag.x - z.x, this.drag.y - z.y) < z.r;
    G.strokeStyle = anyIn ? 'rgba(79,224,138,.85)' : 'rgba(120,150,140,.4)'; G.lineWidth = 2; G.setLineDash([6, 5]); G.beginPath(); G.arc(z.x, z.y, z.r, 0, 7); G.stroke(); G.setLineDash([]);
    G.fillStyle = 'rgba(111,138,124,.7)'; G.font = '9px monospace'; G.textAlign = 'center'; G.fillText('POUR ZONE', z.x, z.y - z.r - 6);
    this.drips.forEach(d => { G.globalAlpha = 1 - d.life / 0.6; G.fillStyle = d.col; G.beginPath(); G.arc(d.x, d.y, 2.2, 0, 7); G.fill(); }); G.globalAlpha = 1;
    this.cans.forEach(p => { if (p.done) return;
      if (this.drag === p && p.poured > 0 && p.poured < 1) { G.strokeStyle = p.d.color; G.globalAlpha = .7; G.lineWidth = 3; G.beginPath(); G.moveTo(p.x, p.y + 6); G.lineTo(b.x + rnd(4, -4), b.y - b.h / 2 + 10); G.stroke(); G.globalAlpha = 1; }
      const groundY = H * 0.60, lift = clamp((groundY - p.y) / 140, 0, 1);
      G.save(); G.globalAlpha = .4 * (1 - lift * .5); G.fillStyle = '#000'; G.beginPath(); G.ellipse(p.x, groundY, 20 + lift * 8, 5, 0, 0, 7); G.fill(); G.restore();
      drawPackage(p.d, p.x, p.y, false, this.hover === p || this.drag === p, this.t, { tilt: p.tilt, slosh: p.slosh, warn: p.warn, held: this.drag === p });
    });
    drawCarryWarn(this);
  },
};

// MIX = REDUCE: turn every form into a liquid its own way — crush solids,
// dissolve powders, bleed gas, cut paste — each pouring into the beaker.
// Buttonless: mash SPACE/click for solids, hold for the rest.
STAGES.mix = {
  enter() {
    const g = game; this.t = 0; this.queue = g.selected.slice(); this.idx = 0; this.meter = 0; this.fill = 0;
    this.hold = false; this.crushHits = 0; this.frags = []; this.cloud = []; this.done = false;
    this.beaker = { x: W / 2, y: H * 0.52, w: 140, h: 200 };
    g.lab.ticker('REDUCE — turn every form into a liquid: crush solids, dissolve powders, bleed gas, cut paste.');
    this.setupCurrent();
    AX.loop('whir', { freq: 110, type: 'triangle', gain: 0, filt: 700, tremRate: 20, tremDepth: .5 });
  },
  exit() { AX.stop('whir'); },
  setupCurrent() {
    const d = this.queue[this.idx]; this.meter = 0; this.crushHits = 0; if (!d) return; const f = d.form;
    if (f === 'liquid') { this.mode = 'auto'; this.rate = 1.1; this.label = 'ALREADY LIQUID — decanting'; }
    else if (f === 'crystal' || f === 'pill') { this.mode = 'crush'; this.label = 'CRUSH — mash SPACE / click'; }
    else if (f === 'leaf') { this.mode = 'crush'; this.label = 'GRIND — mash SPACE / click'; }
    else if (f === 'gas') { this.mode = 'hold'; this.rate = 0.42; this.label = 'BLEED the valve — hold'; }
    else if (f === 'gel') { this.mode = 'hold'; this.rate = 0.30; this.label = 'WORK it down — hold'; }
    else if (f === 'paste') { this.mode = 'hold'; this.rate = 0.22; this.label = 'CUT with solvent — hold'; }
    else if (f === 'blotter') { this.mode = 'hold'; this.rate = 0.34; this.label = 'STEEP — hold, gently'; }
    else { this.mode = 'hold'; this.rate = 0.5; this.label = 'DISSOLVE the powder — hold'; }
  },
  advance() {
    const d = this.queue[this.idx]; this.idx++; this.fill = clamp(this.idx / this.queue.length, 0, 1);
    for (let i = 0; i < 12; i++) this.cloud.push({ x: this.beaker.x + rnd(28, -28), y: this.beaker.y - 52, vx: rnd(50, -50), vy: rnd(-30, -90), life: 0, ttl: .6, col: d.color });
    AX.drop();
    if (this.idx >= this.queue.length) { if (!this.done) { this.done = true; game.scores.mix = 0.9; AX.good(); game.lab.ticker('all reduced to a clean liquid.'); setTimeout(() => { if (game && !game.closed && stage === this) transit(game, 'pour'); }, 650); } }
    else this.setupCurrent();
  },
  mash() { if (this.mode !== 'crush' || this.done) return; this.crushHits++; this.meter = clamp(this.meter + 0.16, 0, 1); AX.tick();
    const d = this.queue[this.idx]; for (let i = 0; i < 5; i++) this.frags.push({ x: rnd(18, -18), y: rnd(8, -8), vx: rnd(130, -130), vy: rnd(-70, -170), life: 0, ttl: .5, col: d.color });
    if (this.meter >= 1) this.advance();
  },
  down() { if (this.mode === 'crush') this.mash(); else this.hold = true; },
  up() { this.hold = false; },
  key(e) { if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); if (this.mode === 'crush') this.mash(); else this.hold = true; } },
  keyup(e) { if (e.code === 'Space' || e.key === ' ') this.hold = false; },
  update(dt) { this.t += dt; const d = this.queue[this.idx];
    if (d && !this.done) {
      if (this.mode === 'auto') { this.meter = clamp(this.meter + dt * this.rate, 0, 1); if (this.meter >= 1) this.advance(); }
      else if (this.mode === 'hold') { AX.loopGain('whir', (this.hold ? 1 : 0) * .1); if (this.hold) { this.meter = clamp(this.meter + dt * this.rate, 0, 1); if (this.meter >= 1) this.advance(); } }
    }
    this.frags.forEach(fr => { fr.life += dt; fr.x += fr.vx * dt; fr.y += fr.vy * dt; fr.vy += 500 * dt; }); this.frags = this.frags.filter(fr => fr.life < fr.ttl);
    this.cloud.forEach(c => { c.life += dt; c.x += c.vx * dt; c.y += c.vy * dt; c.vy += 300 * dt; }); this.cloud = this.cloud.filter(c => c.life < c.ttl);
  },
  draw() {
    const b = this.beaker, base = b.y + b.h / 2, cy = b.y - b.h / 2 - 50;
    drawBeaker(b, () => { if (this.fill > 0.001) { const done = this.queue.slice(0, this.idx); const col = avgColor(done.length ? done : this.queue); const top = base - (b.h * 0.66) * this.fill; fillLiquid(b.x - b.w / 2, b.w, top, base, col, col, this.t, 0.1, 0.15); } });
    const d = this.queue[this.idx];
    if (d && !this.done) {
      const held = this.mode === 'hold' && this.hold;
      G.save(); G.globalAlpha = 1 - this.meter * 0.55;
      drawPackage(d, b.x, cy, false, false, this.t, { tilt: held ? -0.5 : (this.mode === 'crush' ? Math.sin(this.t * 28) * 0.05 : 0), slosh: held ? 0.6 : 0 });
      G.restore();
      if (held) { G.strokeStyle = d.color; G.globalAlpha = .7; G.lineWidth = 3; G.beginPath(); G.moveTo(b.x, cy + 12); G.lineTo(b.x + rnd(4, -4), base - b.h + 10); G.stroke(); G.globalAlpha = 1; }
      G.textAlign = 'center'; G.fillStyle = '#6f8a7c'; G.font = '9px monospace'; G.fillText(`${(d.known ?? 1) > .4 ? d.name : 'UNKNOWN'} · ${this.idx + 1}/${this.queue.length}`, b.x, cy - 54);
      G.fillStyle = '#cfe9d8'; G.font = 'bold 11px monospace'; G.fillText(this.label, b.x, cy - 40);
      const mw = 150, mx = b.x - mw / 2, my = base + 16;
      G.fillStyle = '#0a0f0c'; G.strokeStyle = 'rgba(132,150,168,.3)'; roundRect(mx, my, mw, 8, 3); G.fill(); G.stroke();
      G.fillStyle = this.mode === 'crush' ? '#ffb23e' : '#4fe08a'; roundRect(mx, my, mw * this.meter, 8, 3); G.fill();
    }
    this.frags.forEach(fr => { G.globalAlpha = 1 - fr.life / fr.ttl; G.fillStyle = fr.col; G.fillRect(b.x + fr.x, cy + fr.y, 3, 3); }); G.globalAlpha = 1;
    this.cloud.forEach(c => { G.globalAlpha = 1 - c.life / c.ttl; G.fillStyle = c.col; G.beginPath(); G.arc(c.x, c.y, 2.5, 0, 7); G.fill(); }); G.globalAlpha = 1;
  },
};

STAGES.pour = {
  enter() { const g = game; this.t = 0; this.stepIdx = 0; this.level = 0; this.vel = 0; this.pouring = false; this.locked = [];
    this.steps = [ { name: 'REAGENT', col: '#4fe08a', target: .55, band: clamp(.14 - g.diff() * .0025, .07, .14) },
      { name: 'CATALYST', col: '#9a5ce0', target: .78, band: clamp(.11 - g.diff() * .0025, .05, .11), touchy: true } ];
    this.drops = []; this.beaker = { x: W / 2, y: H * 0.5, w: 150, h: 210 };
    g.lab.ticker('pour the REAGENT to its line. hold to pour, release on the mark. the stream lags — anticipate.');
    this.b = mkBtn('HOLD TO POUR / RELEASE ON MARK', 'left:50%;top:40px;transform:translateX(-50%)', 'ghost'); this.b.style.pointerEvents = 'none';
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
    if (this.pouring) { this.vel += dt * (s.touchy ? 0.34 : 0.48); for (let i = 0; i < 2; i++) this.drops.push({ x: this.beaker.x + rnd(6, -6), y: this.beaker.y - this.beaker.h / 2 - 30, vy: 200, life: 0, col: s.col }); }
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
    this.bar = mkEl('position:absolute;left:50%;top:40px;transform:translateX(-50%);color:#6f8a7c;font-size:9px;letter-spacing:2px;text-transform:uppercase;pointer-events:none');
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
    const d = g.diff(); this.gravity = 0.8 + d * .04; this.push = 1.7 + d * .04; this.bandHalf = clamp(.20 - d * .006, .09, .20); this.bandSpeed = .09 + d * .018;
    this.beaker = { x: W / 2, y: H * 0.48, w: 120, h: 230 }; this.bubbles = []; this.heatS = 0;
    g.lab.ticker('STABILIZE — hold to heat, keep the reagent in the green band. let it run away and it bites.');
    this.bar = mkEl('position:absolute;left:50%;top:40px;transform:translateX(-50%);color:#6f8a7c;font-size:9px;letter-spacing:2px;text-transform:uppercase;pointer-events:none');
    AX.loop('burner', { freq: 70, type: 'sawtooth', gain: .04, filt: 520, tremRate: 11, tremDepth: .35 });
  },
  exit() { AX.stop('burner'); },
  down() { this.hold = true; }, up() { this.hold = false; },
  key(e) { if (e.code === 'Space') { e.preventDefault(); this.hold = true; } }, keyup(e) { if (e.code === 'Space') this.hold = false; },
  band() { const c = .5 + (.5 - this.bandHalf) * .5 * Math.sin(this.t * this.bandSpeed * Math.PI * 2); return clamp(c, this.bandHalf, 1 - this.bandHalf); },
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
    this.readout = mkEl('position:absolute;left:50%;top:40px;transform:translateX(-50%);color:#6f8a7c;font-size:11px;letter-spacing:2px;text-transform:uppercase;pointer-events:none;min-width:120px;text-align:center');
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

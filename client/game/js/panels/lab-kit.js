// LAB KIT — shared rendering + audio + overlay shell for the chemistry
// minigames (the SPLICE orchestra in splicelab.js and the COOK gauge in
// synthlab.js). Extracted from the standalone splice test rig so both games
// share one gritty, futuristic "salvaged corp medlab" look.
//
// Canvas helpers draw to a module-current context set by useCanvas(); the
// live-binding exports G/W/H update for importers when a minigame mounts.
// All audio is a tiny self-contained WebAudio synth (no assets), guarded.

// ── math / util ──────────────────────────────────────────────────────────────
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rnd = (a = 1, b = 0) => b + Math.random() * (a - b);
export const ease = (t) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// ── colour math ──────────────────────────────────────────────────────────────
export function hexToRgb(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(x => x + x).join(''); const n = parseInt(h, 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
export function toRgb(c) { if (typeof c === 'object') return c; if (c[0] === '#') return hexToRgb(c); const m = c.match(/\d+/g).map(Number); return { r: m[0], g: m[1], b: m[2] }; }
export function shade(col, amt) { const c = toRgb(col); return `rgb(${clamp(c.r + amt, 0, 255) | 0},${clamp(c.g + amt, 0, 255) | 0},${clamp(c.b + amt, 0, 255) | 0})`; }
export function mixColors(a, b, t) { const A = toRgb(a), B = toRgb(b); return `rgb(${lerp(A.r, B.r, t) | 0},${lerp(A.g, B.g, t) | 0},${lerp(A.b, B.b, t) | 0})`; }
export function avgColor(list) { let r = 0, g = 0, bb = 0; list.forEach(d => { const c = hexToRgb(d.color || '#4fe08a'); r += c.r; g += c.g; bb += c.b; }); const n = list.length || 1; return `rgb(${r / n | 0},${g / n | 0},${bb / n | 0})`; }

// ── current canvas (live bindings) ───────────────────────────────────────────
export let G = null, W = 0, H = 0;
export function useCanvas(ctx, w, h) { G = ctx; W = w; H = h; }

// ── shapes ───────────────────────────────────────────────────────────────────
export function roundRect(x, y, w, h, r) { G.beginPath(); G.moveTo(x + r, y); G.arcTo(x + w, y, x + w, y + h, r); G.arcTo(x + w, y + h, x, y + h, r); G.arcTo(x, y + h, x, y, r); G.arcTo(x, y, x + w, y, r); G.closePath(); }
export function blob(cx, cy, rx, ry, t) { G.beginPath(); for (let a = 0; a <= Math.PI * 2 + .01; a += .4) { const r = 1 + Math.sin(a * 3 + t * 1.5) * .08; const px = cx + Math.cos(a) * rx * r, py = cy + Math.sin(a) * ry * r; a === 0 ? G.moveTo(px, py) : G.lineTo(px, py); } G.closePath(); }

// ── liquid / glass / steam / atmosphere ──────────────────────────────────────
export function surfaceY(x, baseY, t, slosh) {
  const a = (1.2 + slosh * 7);
  return baseY + Math.sin(x * 0.06 + t * 2.2) * a * .6 + Math.sin(x * 0.13 - t * 3.1) * a * .4 + Math.sin(x * 0.021 + t * 1.3) * a * slosh * 1.4;
}
export function fillLiquid(x, w, topY, botY, colTop, colBot, t, slosh, glow) {
  slosh = slosh || 0;
  G.save();
  G.beginPath(); G.moveTo(x, botY); G.lineTo(x, topY);
  for (let px = x; px <= x + w; px += 6) G.lineTo(px, surfaceY(px, topY, t, slosh));
  G.lineTo(x + w, botY); G.closePath(); G.clip();
  const lg = G.createLinearGradient(0, topY - 8, 0, botY);
  lg.addColorStop(0, shade(colTop, 34)); lg.addColorStop(.18, colTop); lg.addColorStop(1, shade(colBot, -26));
  G.fillStyle = lg; G.fillRect(x, topY - 24, w, botY - topY + 30);
  if (glow) { const rg = G.createRadialGradient(x + w / 2, botY, 4, x + w / 2, botY, w * .9); rg.addColorStop(0, `rgba(255,255,255,${glow * .22})`); rg.addColorStop(1, 'rgba(255,255,255,0)'); G.fillStyle = rg; G.fillRect(x, topY - 24, w, botY - topY + 30); }
  G.restore();
  G.save(); G.lineWidth = 2; G.strokeStyle = shade(colTop, 60); G.shadowColor = colTop; G.shadowBlur = 10;
  G.beginPath(); for (let px = x; px <= x + w; px += 6) { const yy = surfaceY(px, topY, t, slosh); px === x ? G.moveTo(px, yy) : G.lineTo(px, yy); } G.stroke();
  G.shadowBlur = 0; G.globalAlpha = .5; G.lineWidth = 1; G.strokeStyle = 'rgba(255,255,255,.5)';
  G.beginPath(); for (let px = x; px <= x + w; px += 6) { const yy = surfaceY(px, topY, t, slosh) - 2; px === x ? G.moveTo(px, yy) : G.lineTo(px, yy); } G.stroke();
  G.restore();
}
export function drawSteam(cx, y, amount, t, tint) {
  if (amount <= 0.02) return; tint = tint || '220,240,225';
  G.save(); G.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) { const ph = i * 1.7 + t * (.5 + i * .08); const rise = ((t * 22 * (0.5 + amount)) + i * 40) % 180;
    const sx = cx + Math.sin(ph) * (10 + rise * .18) + Math.sin(t + i) * 4; const sy = y - rise; const r = 6 + rise * .14 + amount * 6;
    const a = clamp((1 - rise / 180) * amount * .14, 0, .14);
    const g = G.createRadialGradient(sx, sy, 0, sx, sy, r); g.addColorStop(0, `rgba(${tint},${a})`); g.addColorStop(1, `rgba(${tint},0)`);
    G.fillStyle = g; G.beginPath(); G.arc(sx, sy, r, 0, 7); G.fill(); }
  G.restore();
}
let _motes = null;
export function dustMotes(t, n, tint) { if (!_motes) { _motes = Array.from({ length: 60 }, () => ({ x: rnd(W), y: rnd(H), z: rnd(1, .2), s: rnd(1.4, .4), ph: rnd(7) })); }
  G.save(); G.globalCompositeOperation = 'lighter'; tint = tint || '150,220,180';
  for (let i = 0; i < (n || 60); i++) { const m = _motes[i]; m.x += Math.sin(t * .3 + m.ph) * .15 * m.z; m.y += (.06 + m.z * .14); if (m.y > H) m.y = 0;
    const a = (.08 + Math.sin(t * 1.3 + m.ph) * .05) * m.z; G.fillStyle = `rgba(${tint},${clamp(a, 0, .16)})`; G.beginPath(); G.arc(m.x, m.y, m.s * m.z, 0, 7); G.fill(); }
  G.restore();
}
export function lightShaft(cx, topW, botW, h, tint, a) {
  G.save(); G.globalCompositeOperation = 'lighter';
  const g = G.createLinearGradient(0, 0, 0, h); g.addColorStop(0, `rgba(${tint},${a})`); g.addColorStop(1, `rgba(${tint},0)`);
  G.fillStyle = g; G.beginPath(); G.moveTo(cx - topW / 2, 0); G.lineTo(cx + topW / 2, 0); G.lineTo(cx + botW / 2, h); G.lineTo(cx - botW / 2, h); G.closePath(); G.fill(); G.restore();
}
export function condensation(x, y, w, h, seed, density) { G.save();
  for (let i = 0; i < (density || 16); i++) { const px = x + ((i * 97 + seed * 13) % w), py = y + ((i * 53 + seed * 29) % h), r = ((i * 7 + seed) % 3) * .6 + .5;
    G.fillStyle = 'rgba(220,240,245,.22)'; G.beginPath(); G.arc(px, py, r, 0, 7); G.fill();
    G.fillStyle = 'rgba(255,255,255,.35)'; G.beginPath(); G.arc(px - r * .3, py - r * .3, r * .4, 0, 7); G.fill(); }
  G.restore();
}

// gritty steel bench + hazard stencil backdrop, shared by every stage
let _benchT = 0;
export function drawBench() {
  _benchT += .016;
  const bg = G.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0a0f12'); bg.addColorStop(.55, '#070b0e'); bg.addColorStop(1, '#04070a');
  G.fillStyle = bg; G.fillRect(0, 0, W, H);
  const by = H * 0.62;
  const steel = G.createLinearGradient(0, by, 0, H); steel.addColorStop(0, '#161c21'); steel.addColorStop(1, '#0c1114');
  G.fillStyle = steel; G.fillRect(0, by, W, H - by);
  G.strokeStyle = 'rgba(0,0,0,.6)'; G.lineWidth = 2; G.beginPath(); G.moveTo(0, by); G.lineTo(W, by); G.stroke();
  G.strokeStyle = 'rgba(120,150,140,.06)'; G.lineWidth = 1;
  for (let x = 0; x < W; x += 6) { G.beginPath(); G.moveTo(x, by + 2); G.lineTo(x - 14, H); G.stroke(); }
  G.fillStyle = 'rgba(40,60,30,.06)';
  G.beginPath(); G.ellipse(W * .2, by + 40, 120, 30, 0, 0, 7); G.fill();
  G.beginPath(); G.ellipse(W * .8, by + 60, 160, 40, 0, 0, 7); G.fill();
  G.save(); G.globalAlpha = .05; G.font = 'bold 120px monospace'; G.fillStyle = '#ffb23e'; G.textAlign = 'center';
  G.fillText('☣', W * .5, H * .4); G.restore();
}

export function beakerPath(x, y, w, h, r) { G.beginPath(); G.moveTo(x, y + 16); G.lineTo(x, y + h - r); G.arc(x + r, y + h - r, r, Math.PI, 0, true); G.lineTo(x + w, y + 16); }
export function drawBeaker(b, fillFn) {
  const x = b.x - b.w / 2, y = b.y - b.h / 2, w = b.w, h = b.h, r = w / 2;
  G.save();
  const sh = G.createRadialGradient(b.x, y + h + 4, 4, b.x, y + h + 4, w * .8); sh.addColorStop(0, 'rgba(0,0,0,.5)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  G.fillStyle = sh; G.beginPath(); G.ellipse(b.x, y + h + 6, w * .62, 12, 0, 0, 7); G.fill();
  G.strokeStyle = 'rgba(120,140,150,.35)'; G.lineWidth = 6; G.beginPath(); G.moveTo(x + w + 2, y + 20); G.lineTo(x + w + 40, y + 20); G.stroke();
  G.strokeStyle = 'rgba(90,110,120,.5)'; G.lineWidth = 2; G.beginPath(); G.arc(x + w + 8, y + 20, 7, -1, 4, false); G.stroke();
  beakerPath(x, y, w, h, r); G.save(); G.clip();
  if (fillFn) fillFn();
  const inw = G.createLinearGradient(x, 0, x + w, 0);
  inw.addColorStop(0, 'rgba(10,20,18,.55)'); inw.addColorStop(.10, 'rgba(10,20,18,0)'); inw.addColorStop(.9, 'rgba(10,20,18,0)'); inw.addColorStop(1, 'rgba(10,20,18,.55)');
  G.fillStyle = inw; G.fillRect(x, y, w, h);
  G.restore();
  const cav = G.createLinearGradient(x, 0, x + w, 0); cav.addColorStop(0, 'rgba(180,220,230,.09)'); cav.addColorStop(.5, 'rgba(180,220,230,.015)'); cav.addColorStop(1, 'rgba(180,220,230,.09)');
  G.fillStyle = cav; beakerPath(x, y, w, h, r); G.closePath(); G.fill();
  beakerPath(x, y, w, h, r); G.strokeStyle = 'rgba(205,240,245,.55)'; G.lineWidth = 2.5; G.stroke();
  G.strokeStyle = 'rgba(120,200,180,.35)'; G.lineWidth = 1; G.stroke();
  beakerPath(x + 3, y, w - 6, h - 3, r - 3); G.strokeStyle = 'rgba(255,255,255,.10)'; G.lineWidth = 1; G.stroke();
  G.strokeStyle = 'rgba(225,248,252,.75)'; G.lineWidth = 2.5; G.beginPath(); G.moveTo(x - 6, y + 8); G.lineTo(x + w + 6, y + 8); G.stroke();
  G.lineWidth = 2; G.beginPath(); G.moveTo(x, y + 16); G.lineTo(x - 6, y + 8); G.moveTo(x + w, y + 16); G.lineTo(x + w + 6, y + 8); G.stroke();
  G.strokeStyle = 'rgba(200,235,240,.22)'; G.lineWidth = 1;
  for (let i = 1; i < 7; i++) { const yy = y + h * 0.28 + (h * 0.62) * (i / 7); G.beginPath(); G.moveTo(x + w - (i % 2 ? 8 : 15), yy); G.lineTo(x + w - 3, yy); G.stroke(); }
  const sp = G.createLinearGradient(x, 0, x + 18, 0); sp.addColorStop(0, 'rgba(255,255,255,0)'); sp.addColorStop(.5, 'rgba(255,255,255,.28)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
  G.fillStyle = sp; G.fillRect(x + 8, y + 22, 7, h - 52);
  const sp2 = G.createLinearGradient(x + w - 16, 0, x + w - 4, 0); sp2.addColorStop(0, 'rgba(255,255,255,0)'); sp2.addColorStop(.6, 'rgba(255,255,255,.12)'); sp2.addColorStop(1, 'rgba(255,255,255,0)');
  G.fillStyle = sp2; G.fillRect(x + w - 14, y + 30, 5, h - 70);
  G.restore();
}
export function drawBurner(b, heat, t) {
  const cx = b.x, baseY = b.y + b.h / 2 + 40;
  const flick = .85 + .15 * Math.sin(t * 22) + rnd(.06, -.06);
  const Hh = (24 + heat * 74) * flick, sway = Math.sin(t * 7) * (2 + heat * 4);
  const glow = G.createRadialGradient(cx, baseY - Hh * .4, 4, cx, baseY - Hh * .4, 50 + heat * 30); glow.addColorStop(0, `rgba(255,150,40,${(.12 + heat * .28)})`); glow.addColorStop(1, 'rgba(255,150,40,0)');
  G.fillStyle = glow; G.fillRect(cx - 90, baseY - Hh - 40, 180, Hh + 60);
  G.save(); G.globalCompositeOperation = 'lighter';
  flame(cx, baseY, 15 + heat * 5, Hh, sway, 'rgba(230,90,20,.85)', 14);
  flame(cx, baseY, 11 + heat * 3, Hh * .82, sway * .8, 'rgba(255,170,40,.9)', 10);
  flame(cx, baseY, 7 + heat * 2, Hh * .6, sway * .6, 'rgba(255,235,150,.95)', 6);
  flame(cx, baseY, 8, 14 + heat * 10, sway * .3, 'rgba(90,150,255,.6)', 6);
  G.restore();
  G.fillStyle = '#2a3138'; G.fillRect(cx - 11, baseY + 2, 22, H - (baseY + 2)); G.fillStyle = '#12161a'; G.fillRect(cx - 15, baseY, 30, 4);
}
export function flame(cx, baseY, hw, ht, sway, col, blur) { G.beginPath(); G.moveTo(cx - hw, baseY); G.quadraticCurveTo(cx - hw, baseY - ht * .55, cx + sway, baseY - ht); G.quadraticCurveTo(cx + hw, baseY - ht * .55, cx + hw, baseY); G.quadraticCurveTo(cx, baseY + 5, cx - hw, baseY); G.closePath(); G.shadowColor = col; G.shadowBlur = blur; G.fillStyle = col; G.fill(); G.shadowBlur = 0; }

// ── audio (tiny WebAudio synth, no assets, guarded) ──────────────────────────
export const AX = (() => {
  let ac = null; const loops = {};
  const ctx = () => { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } } if (ac && ac.state === 'suspended') ac.resume(); return ac; };
  function tone(freq, dur, o = {}) { const a = ctx(); if (!a) return; const t = a.currentTime; const osc = a.createOscillator(), g = a.createGain(); osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(freq, t); if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur); let node = osc; if (o.filt) { const f = a.createBiquadFilter(); f.type = o.filt.type || 'lowpass'; f.frequency.value = o.filt.freq || 800; f.Q.value = o.filt.q || 1; osc.connect(f); node = f; } node.connect(g); g.connect(a.destination); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.gain ?? .2, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + dur); osc.start(t); osc.stop(t + dur + .02); }
  function noise(dur, o = {}) { const a = ctx(); if (!a) return; const t = a.currentTime; const n = a.createBufferSource(), buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1); n.buffer = buf; const f = a.createBiquadFilter(); f.type = o.type || 'lowpass'; f.frequency.value = o.freq || 800; f.Q.value = o.q || 1; const g = a.createGain(); n.connect(f); f.connect(g); g.connect(a.destination); g.gain.setValueAtTime(o.gain ?? .2, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur); n.start(t); n.stop(t + dur + .02); }
  function loop(id, o = {}) { const a = ctx(); if (!a || loops[id]) return; const osc = a.createOscillator(), g = a.createGain(), f = a.createBiquadFilter(); osc.type = o.type || 'sawtooth'; osc.frequency.value = o.freq || 90; f.type = 'lowpass'; f.frequency.value = o.filt || 520; osc.connect(f); f.connect(g); g.connect(a.destination); g.gain.value = o.gain ?? .06; osc.start(); let lfo = null, lg = null; if (o.tremRate) { lfo = a.createOscillator(); lg = a.createGain(); lfo.frequency.value = o.tremRate; lg.gain.value = (o.gain ?? .06) * (o.tremDepth || 0); lfo.connect(lg); lg.connect(g.gain); lfo.start(); } loops[id] = { osc, g, lfo }; }
  function loopGain(id, v) { const l = loops[id]; if (l) { const a = ctx(); l.g.gain.linearRampToValueAtTime(v, a.currentTime + .08); } }
  function stop(id) { const l = loops[id]; if (l) { try { l.osc.stop(); l.lfo && l.lfo.stop(); } catch (e) { } delete loops[id]; } }
  function stopAll() { for (const id in loops) stop(id); }
  return {
    tone, noise, loop, loopGain, stop, stopAll,
    click: () => tone(1400, .05, { type: 'square', gain: .12, to: 800 }),
    tick: () => tone(2000, .03, { type: 'square', gain: .06 }),
    good: () => { tone(520, .12, { type: 'triangle', gain: .2 }); setTimeout(() => tone(780, .16, { type: 'triangle', gain: .2 }), 90); },
    perfect: () => { tone(660, .09, { gain: .22 }); setTimeout(() => tone(990, .14, { gain: .22 }), 70); setTimeout(() => tone(1320, .18, { gain: .18 }), 150); },
    bad: () => tone(150, .3, { type: 'sawtooth', gain: .2, to: 70 }),
    drop: () => { noise(.18, { gain: .25, freq: 400 }); tone(300, .14, { type: 'sine', gain: .12, to: 120 }); },
    pour: (on) => { if (on) loop('pour', { freq: 220, type: 'sawtooth', gain: .05, filt: 900, tremRate: 18, tremDepth: .5 }); else stop('pour'); },
    klaxon: () => { for (let i = 0; i < 4; i++) setTimeout(() => tone(440, .3, { type: 'sawtooth', gain: .25, to: 300 }), i * 260); noise(1.4, { gain: .3, freq: 1600, type: 'highpass' }); },
    shatter: () => { noise(.5, { gain: .4, freq: 3000, type: 'highpass', q: .5 }); for (let i = 0; i < 8; i++) setTimeout(() => tone(600 + Math.random() * 3000, .08, { type: 'triangle', gain: .08 }), Math.random() * 300); },
  };
})();

// ── overlay shell ────────────────────────────────────────────────────────────
function ensureLabStyles() {
  if (document.getElementById('lab-kit-styles')) return;
  const s = document.createElement('style'); s.id = 'lab-kit-styles';
  s.textContent = `
  .lab-overlay{position:fixed;inset:0;z-index:9996;display:flex;align-items:center;justify-content:center;background:rgba(2,5,4,.86);backdrop-filter:blur(3px);font-family:var(--font-mono,monospace)}
  .lab-rig{position:relative;width:min(94vw,940px);aspect-ratio:960/604;border-radius:16px;overflow:hidden;background:linear-gradient(180deg,#0c1116,#070b0f 40%,#04070a);border:1px solid #05070a;box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 24px 70px rgba(0,0,0,.8),0 0 50px color-mix(in srgb,var(--acc,#4fe08a) 12%,transparent)}
  .lab-rig canvas.lab-stage{position:absolute;inset:0;width:100%;height:100%;display:block}
  .lab-fx{position:absolute;inset:0;pointer-events:none;z-index:5}
  .lab-fx.scan{background:repeating-linear-gradient(0deg,transparent 0 2px,rgba(0,0,0,.16) 2px 3px);opacity:.5;mix-blend-mode:multiply}
  .lab-fx.vig{box-shadow:inset 0 0 140px rgba(0,0,0,.75),inset 0 0 40px rgba(0,0,0,.5)}
  .lab-fx.grid{opacity:.09;background-image:linear-gradient(rgba(79,224,138,.5) 1px,transparent 1px),linear-gradient(90deg,rgba(79,224,138,.5) 1px,transparent 1px);background-size:30px 30px;animation:lab-drift 8s linear infinite}
  @keyframes lab-drift{to{background-position:0 30px,30px 0}}
  .lab-grain{position:absolute;inset:0;z-index:6;pointer-events:none;opacity:.06;mix-blend-mode:screen;image-rendering:pixelated;width:100%;height:100%}
  .lab-top{position:absolute;top:0;left:0;right:0;height:32px;z-index:8;display:flex;align-items:center;gap:8px;padding:0 12px;font-size:11px;text-transform:uppercase;pointer-events:none;background:linear-gradient(180deg,rgba(6,10,8,.9),transparent)}
  .lab-top .mk{color:var(--acc,#4fe08a);font-size:14px;text-shadow:0 0 10px var(--acc,#4fe08a)}
  .lab-top b{letter-spacing:2px;color:var(--acc,#4fe08a);font-size:12px;text-shadow:1px 0 #ff4a5b,-1px 0 #5fd0e0}
  .lab-top small{opacity:.45;letter-spacing:2px;font-size:8px;color:#9fb8ac}
  .lab-top .close{margin-left:auto;pointer-events:auto;cursor:pointer;color:#8496a8;font-size:13px}
  .lab-top .close:hover{color:#ff4a5b}
  .lab-ui{position:absolute;inset:0;z-index:7;pointer-events:none}
  .lab-btn{position:absolute;pointer-events:auto;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#04120b;background:linear-gradient(180deg,var(--acc,#4fe08a),#2f8a56);border:none;padding:9px 20px;border-radius:4px;font-weight:bold;box-shadow:0 0 18px rgba(79,224,138,.4),inset 0 1px 0 rgba(255,255,255,.4)}
  .lab-btn:hover{filter:brightness(1.14)} .lab-btn:active{transform:translateY(1px)}
  .lab-btn.ghost{background:none;color:#8496a8;border:1px solid rgba(132,150,168,.35);box-shadow:none}
  .lab-btn.ghost:hover{color:var(--acc,#4fe08a);border-color:var(--acc,#4fe08a)}
  .lab-btn[disabled]{opacity:.35;cursor:not-allowed;filter:grayscale(.6)}
  .lab-insta{position:absolute;right:12px;bottom:12px;width:170px;z-index:8;pointer-events:none}
  .lab-insta .lb{font-size:8px;letter-spacing:2px;color:#6f8a7c;display:flex;justify-content:space-between;margin-bottom:3px}
  .lab-insta .bar{height:8px;border:1px solid #05070a;border-radius:3px;background:#0a0f0c;overflow:hidden}
  .lab-insta .fill{height:100%;width:0%;background:linear-gradient(90deg,#4fe08a,#ffb23e 60%,#ff4a5b);box-shadow:0 0 8px rgba(255,74,91,.5);transition:width .18s}
  .lab-ticker{position:absolute;left:12px;bottom:12px;right:196px;z-index:8;pointer-events:none;font-size:10px;color:#6f8a7c;text-shadow:0 0 6px rgba(0,0,0,.9);min-height:14px}
  .lab-ticker b{color:#4fe08a} .lab-ticker .r{color:#ff4a5b} .lab-ticker .a{color:#ffb23e}
  .lab-flash{position:absolute;inset:0;z-index:20;pointer-events:none;background:#fff;opacity:0}
  .lab-hidden{display:none!important}
  `;
  document.head.appendChild(s);
}

// map a pointer event to logical canvas coords (960x604 space)
export function evPos(canvas, e) {
  const r = canvas.getBoundingClientRect();
  const cx = (e.touches ? e.touches[0].clientX : e.clientX), cy = (e.touches ? e.touches[0].clientY : e.clientY);
  return { x: (cx - r.left) / r.width * canvas.width, y: (cy - r.top) / r.height * canvas.height };
}

// Mount a fullscreen minigame overlay: centred rig + canvas + grit + HUD.
// Returns an API; call api.close() to tear down. useCanvas() is pointed here.
export function mountLab({ title = 'CHIMERA-9', subtitle = 'GENESPLICER', accent = '#4fe08a', showInsta = true } = {}) {
  ensureLabStyles();
  const overlay = document.createElement('div');
  overlay.className = 'lab-overlay';
  overlay.innerHTML = `
    <div class="lab-rig" style="--acc:${accent}">
      <canvas class="lab-stage" width="960" height="604"></canvas>
      <div class="lab-fx grid"></div><div class="lab-fx scan"></div>
      <canvas class="lab-grain" width="240" height="151"></canvas>
      <div class="lab-fx vig"></div>
      <div class="lab-top"><span class="mk">&#9879;</span><b>${title}</b> <small>${subtitle}</small><span class="close" title="Abort (Esc)">&#10005;</span></div>
      <div class="lab-ui"></div>
      <div class="lab-insta ${showInsta ? '' : 'lab-hidden'}"><div class="lb"><span>INSTABILITY</span><b class="pct">0%</b></div><div class="bar"><div class="fill"></div></div></div>
      <div class="lab-ticker"></div>
      <div class="lab-flash"></div>
    </div>`;
  document.body.appendChild(overlay);
  const canvas = overlay.querySelector('.lab-stage'), ctx = canvas.getContext('2d');
  useCanvas(ctx, canvas.width, canvas.height);
  const gcv = overlay.querySelector('.lab-grain'), gg = gcv.getContext('2d');
  const grainTimer = setInterval(() => { const id = gg.createImageData(gcv.width, gcv.height); const d = id.data; for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = Math.random() < .5 ? 40 : 0; } gg.putImageData(id, 0, 0); }, 90);

  let closed = false; const closeCbs = [];
  function close() { if (closed) return; closed = true; clearInterval(grainTimer); AX.stopAll(); closeCbs.forEach(fn => { try { fn(); } catch (e) { } }); if (overlay.parentNode) overlay.remove(); }
  overlay.querySelector('.close').addEventListener('click', close);

  return {
    overlay, canvas, ctx,
    ui: overlay.querySelector('.lab-ui'),
    onClose: (fn) => closeCbs.push(fn),
    close,
    ticker: (msg, cls) => { const el = overlay.querySelector('.lab-ticker'); if (el) el.innerHTML = `&gt; ${cls ? `<span class="${cls}">${msg}</span>` : msg}`; },
    setInsta: (v) => { const f = overlay.querySelector('.lab-insta .fill'), p = overlay.querySelector('.lab-insta .pct'); if (f) f.style.width = v + '%'; if (p) { p.textContent = Math.round(v) + '%'; p.style.color = v > 75 ? '#ff4a5b' : v > 45 ? '#ffb23e' : '#4fe08a'; } },
    setTop: (html) => { const el = overlay.querySelector('.lab-top small'); if (el) el.innerHTML = html; },
    flash: (color) => { const f = overlay.querySelector('.lab-flash'); if (!f) return; f.style.transition = 'none'; f.style.background = color || '#fff'; f.style.opacity = '1'; requestAnimationFrame(() => { f.style.transition = 'opacity 1.1s'; f.style.opacity = '0'; }); },
    mkBtn: (label, style, cls) => { const b = document.createElement('button'); b.className = 'lab-btn ' + (cls || ''); b.textContent = label; b.setAttribute('style', style || ''); overlay.querySelector('.lab-ui').appendChild(b); return b; },
  };
}

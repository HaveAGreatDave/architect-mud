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

// Detailed back-wall props for the title/intro: overhead conduits, reagent-bottle
// shelves flanking the hood, a wall monitor with a live waveform, hanging tools,
// grime. All alpha-scale by `pw` (power-up). Draw first (backmost).
const _propCols = ['#e0644f', '#4f9ae0', '#e0b64f', '#7de07a', '#9a5ce0', '#5fd0e0', '#e05cc0', '#d6a0e0', '#c9c9d6', '#7a5a3a'];
export function drawLabProps(t, pw) {
  pw = clamp(pw, 0, 1); if (pw <= 0.02) return;
  // overhead conduits + a wiggling gauge
  for (let i = 0; i < 3; i++) { const y = 8 + i * 9; G.strokeStyle = `rgba(90,104,112,${.4 * pw})`; G.lineWidth = 5 - i; G.beginPath(); G.moveTo(0, y); G.lineTo(W, y); G.stroke(); }
  G.strokeStyle = `rgba(90,104,112,${.4 * pw})`; G.lineWidth = 4; G.beginPath(); G.moveTo(W * 0.18, 12); G.lineTo(W * 0.18, 40); G.moveTo(W * 0.82, 12); G.lineTo(W * 0.82, 52); G.stroke();
  G.fillStyle = `rgba(18,24,28,${pw})`; G.beginPath(); G.arc(W * 0.82, 58, 8, 0, 7); G.fill();
  G.strokeStyle = `rgba(120,200,160,${.7 * pw})`; G.lineWidth = 1.4; G.beginPath(); G.moveTo(W * 0.82, 58); G.lineTo(W * 0.82 + Math.cos(t) * 5, 58 + Math.sin(t) * 5); G.stroke();
  // reagent-bottle shelves
  const shelf = (sx, sy, w, n, seed) => {
    G.fillStyle = `rgba(24,30,34,${.7 * pw})`; G.fillRect(sx, sy, w, 4); G.fillStyle = `rgba(0,0,0,${.4 * pw})`; G.fillRect(sx, sy + 4, w, 3);
    const gap = w / n;
    for (let i = 0; i < n; i++) { const bx = sx + gap * i + gap / 2, col = _propCols[(i + seed) % _propCols.length], bw = 9, bh = 22 + ((i * 7 + seed) % 8);
      G.globalAlpha = pw; G.fillStyle = 'rgba(200,220,225,.12)'; roundRect(bx - bw / 2, sy - bh, bw, bh, 2); G.fill();
      G.fillStyle = col; G.fillRect(bx - bw / 2 + 1, sy - bh * 0.6, bw - 2, bh * 0.6 - 1);
      G.fillStyle = 'rgba(240,240,240,.5)'; G.fillRect(bx - bw / 2 + 1, sy - bh * 0.42, bw - 2, 4);
      G.fillStyle = '#2a343a'; G.fillRect(bx - 3, sy - bh - 3, 6, 4); G.globalAlpha = 1; }
  };
  shelf(W * 0.03, H * 0.20, W * 0.24, 7, 1); shelf(W * 0.03, H * 0.34, W * 0.24, 7, 4);
  shelf(W * 0.73, H * 0.20, W * 0.24, 7, 2); shelf(W * 0.73, H * 0.34, W * 0.24, 7, 6);
  // wall monitor + scrolling waveform (lower-left)
  const mx = W * 0.045, my = H * 0.46, mw = 150, mh = 92;
  G.fillStyle = `rgba(10,14,16,${pw})`; roundRect(mx - 6, my - 6, mw + 12, mh + 12, 6); G.fill();
  G.strokeStyle = `rgba(70,84,92,${pw})`; G.lineWidth = 3; roundRect(mx - 6, my - 6, mw + 12, mh + 12, 6); G.stroke();
  G.save(); roundRect(mx, my, mw, mh, 3); G.clip(); G.fillStyle = `rgba(6,20,14,${pw})`; G.fillRect(mx, my, mw, mh);
  G.strokeStyle = `rgba(79,224,138,${.12 * pw})`; G.lineWidth = 1;
  for (let gx = 0; gx < mw; gx += 16) { G.beginPath(); G.moveTo(mx + gx, my); G.lineTo(mx + gx, my + mh); G.stroke(); }
  for (let gy = 0; gy < mh; gy += 16) { G.beginPath(); G.moveTo(mx, my + gy); G.lineTo(mx + mw, my + gy); G.stroke(); }
  G.strokeStyle = `rgba(95,255,170,${.85 * pw})`; G.lineWidth = 1.5; G.shadowColor = 'rgba(79,224,138,.7)'; G.shadowBlur = 6 * pw; G.beginPath();
  for (let px = 0; px <= mw; px += 3) { const yy = my + mh / 2 + Math.sin(px * 0.09 + t * 3) * 14 * pw + Math.sin(px * 0.31 - t * 5) * 6 * pw; px === 0 ? G.moveTo(mx + px, yy) : G.lineTo(mx + px, yy); }
  G.stroke(); G.shadowBlur = 0; G.restore();
  G.fillStyle = `rgba(120,150,140,${.6 * pw})`; G.font = '7px monospace'; G.textAlign = 'left'; G.fillText('ASSAY ▸ NOMINAL', mx + 2, my + mh - 4);
  // hanging tools (right)
  G.save(); G.globalAlpha = pw; G.strokeStyle = 'rgba(150,170,180,.5)'; G.lineWidth = 3; G.lineCap = 'round'; const tx = W * 0.955;
  G.beginPath(); G.moveTo(tx, H * 0.46); G.lineTo(tx, H * 0.46 + 34); G.lineTo(tx - 8, H * 0.46 + 46); G.stroke();
  G.beginPath(); G.moveTo(tx - 20, H * 0.46); G.lineTo(tx - 20, H * 0.46 + 40); G.stroke(); G.beginPath(); G.arc(tx - 20, H * 0.46 + 44, 4, 0, 7); G.stroke(); G.restore();
  // bench glassware still-life (behind the hero glass)
  G.save(); G.globalAlpha = pw; G.lineWidth = 1.4;
  { const x = W * 0.80, y = H * 0.78, w = 16, h = 64; // graduated cylinder
    G.fillStyle = '#4f9ae0'; G.globalAlpha = pw * .75; G.fillRect(x - w / 2 + 2, y - h * 0.55, w - 4, h * 0.55 - 2); G.globalAlpha = pw;
    G.strokeStyle = 'rgba(200,235,240,.45)'; G.strokeRect(x - w / 2, y - h, w, h);
    G.strokeStyle = 'rgba(200,235,240,.22)'; for (let i = 1; i < 6; i++) { const ty = y - h * (i / 6); G.beginPath(); G.moveTo(x + w / 2 - 5, ty); G.lineTo(x + w / 2, ty); G.stroke(); }
    G.fillStyle = 'rgba(255,255,255,.16)'; G.fillRect(x - w / 2 + 3, y - h + 5, 2.5, h - 10); G.fillStyle = '#2a343a'; G.fillRect(x - w / 2 - 3, y, w + 6, 4); }
  { const x = W * 0.95, y = H * 0.78, r = 26, nw = 9, top = y - r * 2.1; // Erlenmeyer flask
    G.strokeStyle = 'rgba(200,235,240,.45)'; G.beginPath(); G.moveTo(x - nw, top); G.lineTo(x - nw, top + 14); G.lineTo(x - r, y); G.lineTo(x + r, y); G.lineTo(x + nw, top + 14); G.lineTo(x + nw, top); G.stroke();
    G.save(); G.beginPath(); G.moveTo(x - nw, top + 14); G.lineTo(x - r, y); G.lineTo(x + r, y); G.lineTo(x + nw, top + 14); G.closePath(); G.clip();
    G.fillStyle = '#7de07a'; G.globalAlpha = pw * .75; G.fillRect(x - r, y - r * 0.85, r * 2, r * 0.85); G.restore(); G.globalAlpha = pw;
    G.fillStyle = '#2a343a'; G.fillRect(x - nw - 2, top - 4, nw * 2 + 4, 5); }
  { const x = W * 0.87, y = H * 0.80, w = 30, h = 30; // beaker with dregs
    G.fillStyle = '#e0b64f'; G.globalAlpha = pw * .65; G.fillRect(x - w / 2 + 2, y - h * 0.38, w - 4, h * 0.38 - 2); G.globalAlpha = pw;
    G.strokeStyle = 'rgba(200,235,240,.4)'; G.beginPath(); G.moveTo(x - w / 2, y - h); G.lineTo(x - w / 2, y); G.lineTo(x + w / 2, y); G.lineTo(x + w / 2, y - h); G.stroke();
    G.strokeStyle = 'rgba(220,245,250,.55)'; G.beginPath(); G.moveTo(x - w / 2 - 3, y - h); G.lineTo(x + w / 2 + 3, y - h); G.stroke();
    G.fillStyle = 'rgba(255,255,255,.16)'; G.fillRect(x - w / 2 + 3, y - h + 5, 2.5, h - 10); }
  { const x = W * 0.86, y = H * 0.87, rw = 66, tc = ['#e0644f', '#5fd0e0', '#e05cc0', '#9a5ce0']; // test-tube rack
    G.fillStyle = 'rgba(40,50,44,.85)'; G.fillRect(x - rw / 2, y, rw, 6); G.fillStyle = 'rgba(28,36,32,.85)'; G.fillRect(x - rw / 2, y + 6, rw, 4);
    for (let i = 0; i < 4; i++) { const tx = x - rw / 2 + 12 + i * 14, th = 26;
      G.strokeStyle = 'rgba(200,235,240,.4)'; G.beginPath(); G.moveTo(tx - 4, y - th); G.lineTo(tx - 4, y - 4); G.arc(tx, y - 4, 4, Math.PI, 0, true); G.lineTo(tx + 4, y - th); G.stroke();
      G.fillStyle = tc[i]; G.globalAlpha = pw * .8; G.fillRect(tx - 3, y - th * 0.55, 6, th * 0.55 - 3); G.globalAlpha = pw; } }
  G.restore();
  // grime bloom
  G.fillStyle = `rgba(30,44,24,${.05 * pw})`; G.beginPath(); G.ellipse(W * 0.5, H * 0.14, 200, 44, 0, 0, 7); G.fill();
}

// A side-view steel work table (drugs stand on topY). Cyberpunk neon underglow.
export function drawSideTable(x0, x1, topY, accent) {
  accent = accent || '79,224,138'; const w = x1 - x0;
  const g1 = G.createLinearGradient(0, topY, 0, topY + 15); g1.addColorStop(0, '#2b343b'); g1.addColorStop(1, '#12181d');
  G.fillStyle = g1; G.fillRect(x0, topY, w, 14);
  G.fillStyle = 'rgba(0,0,0,.42)'; G.fillRect(x0, topY + 14, w, 6);
  G.fillStyle = 'rgba(170,200,210,.13)'; G.fillRect(x0, topY, w, 3);
  G.strokeStyle = 'rgba(120,160,170,.18)'; G.lineWidth = 1; for (let x = x0 + 2; x < x0 + w; x += 6) { G.beginPath(); G.moveTo(x, topY + 1); G.lineTo(x - 3, topY + 3); G.stroke(); }
  const ng = G.createLinearGradient(0, topY + 18, 0, topY + 36); ng.addColorStop(0, `rgba(${accent},.35)`); ng.addColorStop(1, `rgba(${accent},0)`);
  G.fillStyle = ng; G.fillRect(x0, topY + 18, w, 18);
  G.strokeStyle = `rgba(${accent},.5)`; G.lineWidth = 1.5; G.beginPath(); G.moveTo(x0, topY + 17); G.lineTo(x0 + w, topY + 17); G.stroke();
  G.fillStyle = '#161c21'; G.fillRect(x0 + 16, topY + 18, 12, H - topY - 18); G.fillRect(x0 + w - 28, topY + 18, 12, H - topY - 18);
  G.fillStyle = 'rgba(120,160,170,.10)'; G.fillRect(x0 + 16, topY + 18, 3, H - topY - 18); G.fillRect(x0 + w - 28, topY + 18, 3, H - topY - 18);
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
  // caustic rim glints on the rounded base — a glassy pop (cyberpunk cyan on the far edge)
  G.strokeStyle = 'rgba(255,255,255,.5)'; G.lineWidth = 2; G.beginPath(); G.arc(x + r, y + h - r, r - 4, Math.PI * 1.06, Math.PI * 1.36); G.stroke();
  G.strokeStyle = 'rgba(150,235,255,.4)'; G.lineWidth = 1.4; G.beginPath(); G.arc(x + r, y + h - r, r - 5, Math.PI * -0.02, Math.PI * 0.22); G.stroke();
  G.restore();
}

// A recessed digital readout — machined dark inset + emissive segment glow + faint
// off-segment ghosting, matching the ATM / flight-sim instrument quality.
export function drawLCD(x, y, w, h, text, color = '#4fe08a', label) {
  G.save();
  roundRect(x, y, w, h, 4); const bg = G.createLinearGradient(x, y, x, y + h);
  bg.addColorStop(0, '#04080a'); bg.addColorStop(1, '#0a1517'); G.fillStyle = bg; G.fill();
  G.strokeStyle = 'rgba(0,0,0,.65)'; G.lineWidth = 1.5; roundRect(x, y, w, h, 4); G.stroke();
  G.strokeStyle = 'rgba(150,205,215,.14)'; G.lineWidth = 1; roundRect(x + 1.2, y + 1.2, w - 2.4, h - 2.4, 3); G.stroke();
  G.textAlign = 'center'; G.textBaseline = 'middle';
  const str = String(text ?? '');
  G.font = `bold ${Math.round(h * 0.52)}px 'DejaVu Sans Mono','Consolas','Courier New',monospace`;
  G.fillStyle = 'rgba(120,170,160,.05)'; G.fillText('8'.repeat(Math.max(1, str.length)), x + w / 2, y + h / 2 + 1);
  G.shadowColor = color; G.shadowBlur = 9; G.fillStyle = color; G.fillText(str, x + w / 2, y + h / 2 + 1); G.shadowBlur = 0;
  if (label) { G.font = "7px 'DejaVu Sans Mono',monospace"; G.textAlign = 'left'; G.textBaseline = 'top'; G.fillStyle = 'rgba(150,180,175,.55)'; G.fillText(label, x + 3, y - 9); }
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
    clink: () => { tone(2600, .05, { type: 'sine', gain: .09, to: 3400 }); tone(3800, .035, { type: 'sine', gain: .05 }); noise(.03, { gain: .05, freq: 5000, type: 'highpass' }); },
    alarm: () => { tone(880, .12, { type: 'square', gain: .12 }); setTimeout(() => tone(660, .12, { type: 'square', gain: .12 }), 120); },
    confirm: () => { tone(440, .1, { type: 'triangle', gain: .16, to: 660 }); setTimeout(() => tone(880, .16, { type: 'triangle', gain: .16 }), 90); setTimeout(() => tone(1320, .18, { type: 'sine', gain: .12 }), 180); },
  };
})();

// ── overlay shell ────────────────────────────────────────────────────────────
function ensureLabStyles() {
  if (document.getElementById('lab-kit-styles')) return;
  const s = document.createElement('style'); s.id = 'lab-kit-styles';
  // Chrome borrows the ArchitectOS tablet's token system: the player's --accent drives
  // everything (falling back to the passed lab colour, then green), surfaces are the
  // accent color-mixed into --bg2, with white/black bevels for the hard-plastic look.
  s.textContent = `
  .lab-overlay{position:fixed;inset:0;z-index:9996;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--bg,#05050a) 82%,transparent);backdrop-filter:blur(4px);font-family:'Courier New',var(--font-mono,monospace);pointer-events:none}
  .lab-overlay.lab-nodim{background:transparent;backdrop-filter:none}
  .lab-rig{pointer-events:auto;--A:var(--accent,var(--acc,#4fe08a));
    --surf:color-mix(in srgb,var(--A) 12%,var(--bg2,#0d0d16));
    --surf-hi:color-mix(in srgb,var(--A) 20%,var(--bg2,#0d0d16));
    --surf-lo:color-mix(in srgb,var(--A) 7%,var(--bg2,#0d0d16));
    --bevhi:color-mix(in srgb,#fff 55%,transparent);--bevlo:color-mix(in srgb,#000 45%,transparent);
    --fgdim:color-mix(in srgb,var(--A) 70%,#fff);
    position:relative;width:min(94vw,940px);aspect-ratio:960/604;border-radius:18px;overflow:hidden;
    background:linear-gradient(180deg,color-mix(in srgb,var(--A) 6%,var(--bg2,#0d0d16)),var(--bg,#05050a) 55%);
    border:2px solid color-mix(in srgb,var(--bg2,#0d0d16) 30%,#000 70%);
    box-shadow:inset 0 2px 0 var(--bevhi),inset 0 -3px 8px var(--bevlo),0 24px 70px rgba(0,0,0,.85),0 0 40px color-mix(in srgb,var(--A) 16%,transparent)}
  .lab-rig canvas.lab-stage{position:absolute;inset:0;width:100%;height:100%;display:block}
  .lab-fx{position:absolute;inset:0;pointer-events:none;z-index:5}
  .lab-fx.scan{background:repeating-linear-gradient(0deg,transparent 0 2px,rgba(0,0,0,.18) 2px 3px);opacity:.5;mix-blend-mode:multiply}
  .lab-fx.vig{box-shadow:inset 0 0 140px rgba(0,0,0,.78),inset 0 0 40px rgba(0,0,0,.5)}
  .lab-fx.grid{opacity:.08;background-image:linear-gradient(color-mix(in srgb,var(--A) 50%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--A) 50%,transparent) 1px,transparent 1px);background-size:30px 30px;animation:lab-drift 8s linear infinite}
  @keyframes lab-drift{to{background-position:0 30px,30px 0}}
  .lab-grain{position:absolute;inset:0;z-index:6;pointer-events:none;opacity:.05;mix-blend-mode:screen;image-rendering:pixelated;width:100%;height:100%}
  .lab-top{position:absolute;top:0;left:0;right:0;height:34px;z-index:8;display:flex;align-items:center;gap:8px;padding:0 12px;font-size:11px;text-transform:uppercase;pointer-events:auto;cursor:grab;user-select:none;background:linear-gradient(180deg,color-mix(in srgb,var(--A) 10%,var(--bg,#05050a)),transparent);border-bottom:1px solid color-mix(in srgb,var(--A) 22%,transparent)}
  .lab-top.dragging{cursor:grabbing}
  .lab-top .mk{color:var(--A);font-size:14px;text-shadow:0 0 10px var(--A)}
  .lab-top b{letter-spacing:3px;color:var(--A);font-size:12px;text-shadow:0 0 10px color-mix(in srgb,var(--A) 65%,transparent)}
  .lab-top small{opacity:.85;letter-spacing:2px;font-size:8px;color:color-mix(in srgb,var(--A) 60%,#fff)}
  .lab-top .close{margin-left:auto;pointer-events:auto;cursor:pointer;color:var(--fgdim);font-size:13px}
  .lab-top .close:hover{color:var(--red,#ff4a5b)}
  .lab-ui{position:absolute;inset:0;z-index:7;pointer-events:none}
  .lab-btn{position:absolute;z-index:12;pointer-events:auto;cursor:pointer;font-family:inherit;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:var(--bg,#05050a);background:linear-gradient(180deg,color-mix(in srgb,var(--A) 88%,#fff),var(--A));border:1px solid color-mix(in srgb,var(--A) 55%,#000);padding:11px 24px;border-radius:6px;font-weight:bold;
    box-shadow:inset 0 1px 0 var(--bevhi),0 4px 0 color-mix(in srgb,var(--A) 65%,#000),0 8px 18px rgba(0,0,0,.6),0 0 16px color-mix(in srgb,var(--A) 40%,transparent)}
  .lab-btn:hover{filter:brightness(1.12);transform:translateY(-1px);box-shadow:inset 0 1px 0 var(--bevhi),0 5px 0 color-mix(in srgb,var(--A) 65%,#000),0 10px 20px rgba(0,0,0,.6),0 0 20px color-mix(in srgb,var(--A) 50%,transparent)}
  .lab-btn:active{transform:translateY(3px);box-shadow:inset 0 1px 0 var(--bevhi),0 1px 0 color-mix(in srgb,var(--A) 65%,#000),0 2px 8px rgba(0,0,0,.6)}
  .lab-btn.ghost{background:linear-gradient(180deg,color-mix(in srgb,var(--A) 22%,var(--surf-hi)),var(--surf-lo));color:var(--fgdim);border:1px solid color-mix(in srgb,var(--A) 45%,transparent);
    box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 16%,transparent),0 4px 0 rgba(0,0,0,.55),0 8px 16px rgba(0,0,0,.5)}
  .lab-btn.ghost:hover{color:var(--A);border-color:var(--A)}
  .lab-btn.ghost:active{box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 16%,transparent),0 1px 0 rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.5)}
  .lab-btn[disabled]{opacity:.35;cursor:not-allowed;filter:grayscale(.6)}
  .lab-insta{position:absolute;right:12px;bottom:12px;width:170px;z-index:8;pointer-events:none}
  .lab-insta .lb{font-size:9px;letter-spacing:2px;color:var(--fgdim);display:flex;justify-content:space-between;margin-bottom:3px}
  .lab-insta .bar{height:8px;border:1px solid color-mix(in srgb,#000 50%,var(--A));border-radius:4px;background:var(--surf-lo);overflow:hidden}
  .lab-insta .fill{height:100%;width:0%;background:linear-gradient(90deg,var(--A),var(--orange,#ffb23e) 60%,var(--red,#ff4a5b));box-shadow:0 0 8px rgba(255,74,91,.5);transition:width .18s}
  .lab-ticker{position:absolute;left:12px;bottom:12px;right:196px;z-index:8;pointer-events:none;font-size:11px;color:var(--fgdim);text-shadow:0 0 6px rgba(0,0,0,.9);min-height:15px}
  .lab-ticker b{color:var(--A)} .lab-ticker .r{color:var(--red,#ff4a5b)} .lab-ticker .a{color:var(--orange,#ffb23e)}
  .lab-flash{position:absolute;inset:0;z-index:20;pointer-events:none;background:#fff;opacity:0}
  .lab-hidden{display:none!important}
  .lab-card{width:360px;padding:22px;border-radius:12px;background:linear-gradient(180deg,var(--surf-hi),var(--surf-lo));border:1px solid color-mix(in srgb,var(--A) 34%,transparent);box-shadow:inset 0 1px 0 var(--bevhi),inset 0 -3px 10px var(--bevlo),0 20px 60px rgba(0,0,0,.9);font-family:inherit}
  .lab-field{width:100%;box-sizing:border-box;background:var(--bg,#05050a);border:1px solid color-mix(in srgb,var(--A) 40%,transparent);border-radius:6px;color:var(--A);font-family:inherit;font-size:14px;letter-spacing:1px;padding:9px 11px;text-align:center;outline:none;box-shadow:inset 0 2px 6px rgba(0,0,0,.6)}
  .lab-field:focus{border-color:var(--A);box-shadow:inset 0 2px 6px rgba(0,0,0,.6),0 0 12px color-mix(in srgb,var(--A) 40%,transparent)}
  .lab-field::placeholder{color:var(--fgdim);opacity:.7}
  .lab-shake{animation:lab-shake .4s cubic-bezier(.36,.07,.19,.97) both;border-color:var(--red,#ff4a5b)!important}
  @keyframes lab-shake{10%,90%{transform:translateX(-2px)}20%,80%{transform:translateX(4px)}30%,50%,70%{transform:translateX(-7px)}40%,60%{transform:translateX(7px)}}
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
export function mountLab({ title = 'CHIMERA-9', subtitle = 'GENESPLICER', accent = '#4fe08a', showInsta = true, test = false } = {}) {
  ensureLabStyles();
  const overlay = document.createElement('div');
  overlay.className = 'lab-overlay' + (test ? ' lab-nodim' : '');
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
  function close() { if (closed) return; closed = true; clearInterval(grainTimer); AX.stopAll(); closeCbs.forEach(fn => { try { fn(); } catch (e) { } }); window.removeEventListener('pointermove', onDragMove); window.removeEventListener('pointerup', onDragEnd); if (overlay.parentNode) overlay.remove(); }
  overlay.querySelector('.close').addEventListener('click', close);

  // draggable rig — grab the titlebar (not the close button) and slide the window
  // around by CSS transform, independent of layout so the centred flex box holds.
  const rig = overlay.querySelector('.lab-rig'), top = overlay.querySelector('.lab-top');
  let dragX = 0, dragY = 0, dragging = false, startX = 0, startY = 0;
  function onDragStart(e) {
    if (e.target.closest('.close')) return;
    dragging = true; top.classList.add('dragging');
    startX = e.clientX - dragX; startY = e.clientY - dragY;
    window.addEventListener('pointermove', onDragMove); window.addEventListener('pointerup', onDragEnd);
  }
  function onDragMove(e) {
    if (!dragging) return;
    dragX = e.clientX - startX; dragY = e.clientY - startY;
    rig.style.transform = `translate(${dragX}px,${dragY}px)`;
  }
  function onDragEnd() { dragging = false; top.classList.remove('dragging'); window.removeEventListener('pointermove', onDragMove); window.removeEventListener('pointerup', onDragEnd); }
  top.addEventListener('pointerdown', onDragStart);

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

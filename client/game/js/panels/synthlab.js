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
import { clamp, rnd, shade, G, W, H, roundRect, blob, drawBench, drawBeaker, drawBurner, fillLiquid, drawSteam, drawLCD, dustMotes, lightShaft, AX, mountLab, labBgLight, textShadowOn, evPos } from './lab-kit.js';

// canvas text assumes a dark backdrop by default; the lab can now sit on any theme
// (see lab-kit's labBgLight), so flip these two hardcoded HUD palettes when it does.
const dimCol = () => labBgLight ? '#3f5148' : '#6f8a7c';
const brightCol = () => labBgLight ? '#173226' : '#cfe9d8';

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
    <div class="cm-head"><span>⚗ <b>CHIMERA-9</b> · SYNTHESIZER — pick a batch</span><span class="cm-close" title="close">✕</span></div>
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
  // thicker forms barely bubble, and what does rise creeps slower
  const bubRate = g.opts.form === 'paste' ? .12 : g.opts.form === 'gel' ? .42 : 1;
  const bubSpd = g.opts.form === 'paste' ? .4 : g.opts.form === 'gel' ? .65 : 1;
  if (Math.random() < (g.heatS * .6 + .05) * bubRate) g.bubbles.push({ x: rnd(1, -1), y: 0, r: rnd(3, 1), spd: rnd(1.4, .6) * bubSpd });
  g.bubbles.forEach(b => b.y += b.spd * dt); g.bubbles = g.bubbles.filter(b => b.y < 1);
  if (g.t >= g.dur) { g.workScore = clamp(g.inBand / g.dur, 0, 1); onDone(); }
}

// ── GRIND — leaf nugget + pill press, shared by botanical/leaf and solids/pill ──
// Leaf: a whole nugget sits in the mortar — click it to crack it into pieces,
// then hold the pestle over each piece to work it down to powder. Pills: no
// nugget to crack, they drop straight in as separate pieces and go straight to
// grinding. Either way, once every piece is fully ground a short "add the
// binding liquid" beat plays over the powder before the usual quench-and-seal.
function grindPieceSpawn(g, n, falling) {
  const homeR = g.mortar.r * 0.55;
  g.pieces = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + rnd(0.4, -0.4);
    return { x: g.mortar.x + Math.cos(a) * homeR * rnd(1, .3), y: g.mortar.y + Math.sin(a) * homeR * rnd(1, .3) * .6, r: 15 + rnd(5, -3), ground: false, fall: falling ? -(180 + i * 50) : 0 };
  });
}
function grindInit(g, nugget, tint) {
  g.mortar = { x: W / 2, y: H * 0.52, r: 100 };
  g.pestle = { x: W / 2, y: H * 0.3, active: false };
  g.groundCount = 0; g.nuggetBroken = !nugget;
  g.grindTint = tint || 'rgba(180,200,150,.9)'; g.grindDust = [];   // powder puffs kicked up under the pestle
  if (nugget) { g.nugget = { x: g.mortar.x, y: g.mortar.y, r: 52 }; g.pieces = []; }
  else grindPieceSpawn(g, 5, true);
  AX.loop('grind', { freq: 44, type: 'sawtooth', gain: 0, filt: 240, tremRate: 8, tremDepth: .3 });
}
function grindInput(g, down, p) {
  if (!g.nuggetBroken && down && p) {
    if (Math.hypot(p.x - g.nugget.x, p.y - g.nugget.y) < g.nugget.r) { g.nuggetBroken = true; grindPieceSpawn(g, 6, false); AX.bad(); g.lab.ticker('cracked — now work it down with the pestle.'); return; }
  }
  g.pestle.active = down;
}
function grindMove(g, p) { g.pestle.x = p.x; g.pestle.y = p.y; }
function grindUpdate(g, dt) {
  AX.loopGain('grind', g.pestle.active ? .05 : 0);
  g.pieces.forEach(pc => {
    if (pc.ground) return;
    if (pc.fall < 0) pc.fall = Math.min(0, pc.fall + dt * 500);
    const dx = g.mortar.x - pc.x, dy = g.mortar.y - pc.y, d = Math.hypot(dx, dy) || 1;
    if (d > g.mortar.r - pc.r) { pc.x += dx / d * 70 * dt; pc.y += dy / d * 70 * dt; }
    if (g.pestle.active && pc.fall >= 0) {
      const pd = Math.hypot(pc.x - g.pestle.x, pc.y - g.pestle.y);
      if (pd < 34) { pc.r -= dt * 11;
        if (Math.random() < .55) g.grindDust.push({ x: pc.x + rnd(9, -9), y: pc.y + rnd(5, -5), vx: rnd(70, -70), vy: rnd(-30, -105), life: 0, ttl: rnd(.55, .3), col: shade(g.grindTint, rnd(22, -30)) });
        if (pc.r <= 3) { pc.r = 0; pc.ground = true; g.groundCount++; AX.tick(); } }
    }
  });
  g.grindDust.forEach(d => { d.life += dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 260 * dt; }); g.grindDust = g.grindDust.filter(d => d.life < d.ttl);
  if (g.nuggetBroken && g.pieces.length && g.groundCount >= g.pieces.length) { g.workScore = 1; toLiquidBeat(g); }
}
// a small curled leaf with a central vein + ribs, drug-tinted glass idiom
function drawLeafBit(r, tint) {
  G.fillStyle = 'rgba(0,0,0,.3)'; G.beginPath(); G.ellipse(1.5, r * .55, r * .8, r * .3, 0, 0, 7); G.fill();
  const lg = G.createLinearGradient(-r, -r, r, r); lg.addColorStop(0, shade(tint, 32)); lg.addColorStop(1, shade(tint, -36));
  G.fillStyle = lg; G.beginPath(); G.moveTo(0, -r); G.quadraticCurveTo(r, -r * .2, 0, r); G.quadraticCurveTo(-r, -r * .2, 0, -r); G.closePath(); G.fill();
  G.strokeStyle = shade(tint, -48); G.lineWidth = 1; G.beginPath(); G.moveTo(0, -r * .85); G.lineTo(0, r * .85); G.stroke();
  for (let i = -2; i <= 2; i++) { if (!i) continue; G.beginPath(); G.moveTo(0, i * r * .28); G.lineTo((i > 0 ? 1 : -1) * r * .42, i * r * .28 + r * .22); G.stroke(); }
  G.strokeStyle = shade(tint, 34); G.lineWidth = 1.3; G.beginPath(); G.moveTo(0, -r); G.quadraticCurveTo(r, -r * .2, 0, r); G.quadraticCurveTo(-r, -r * .2, 0, -r); G.stroke();
}
// a scored tablet with a glossy dome highlight
function drawTabletBit(r, tint) {
  G.fillStyle = 'rgba(0,0,0,.3)'; G.beginPath(); G.ellipse(1.5, r * .45, r * .9, r * .34, 0, 0, 7); G.fill();
  const pg = G.createRadialGradient(-r * .3, -r * .3, 2, 0, 0, r); pg.addColorStop(0, shade(tint, 44)); pg.addColorStop(1, shade(tint, -26));
  G.fillStyle = pg; G.beginPath(); G.arc(0, 0, r, 0, 7); G.fill();
  G.strokeStyle = 'rgba(0,0,0,.3)'; G.lineWidth = 1; G.beginPath(); G.moveTo(-r * .8, 0); G.lineTo(r * .8, 0); G.stroke();
  G.fillStyle = 'rgba(255,255,255,.5)'; G.beginPath(); G.ellipse(-r * .3, -r * .32, r * .3, r * .17, -.5, 0, 7); G.fill();
  G.strokeStyle = shade(tint, -32); G.lineWidth = 1; G.beginPath(); G.arc(0, 0, r, 0, 7); G.stroke();
}
function grindDraw(g, label, tint) {
  const m = g.mortar, isLeaf = g.opts.form === 'leaf', t = g.bgT || 0;
  // ── stone mortar: cast shadow, weighted body, deep bowl cavity, lit rim ──
  G.save(); G.fillStyle = 'rgba(0,0,0,.35)'; G.beginPath(); G.ellipse(m.x, m.y + m.r * .52, m.r * 1.02, m.r * .34, 0, 0, 7); G.fill(); G.restore();
  const body = G.createLinearGradient(m.x, m.y - m.r * .4, m.x, m.y + m.r * .72); body.addColorStop(0, '#4a4038'); body.addColorStop(.5, '#332c26'); body.addColorStop(1, '#1b1610');
  G.fillStyle = body; G.beginPath(); G.ellipse(m.x, m.y + m.r * .2, m.r * .98, m.r * .52, 0, 0, 7); G.fill();
  G.fillStyle = 'rgba(255,255,255,.06)'; G.beginPath(); G.ellipse(m.x - m.r * .3, m.y - m.r * .02, m.r * .5, m.r * .22, -.3, 0, 7); G.fill();
  const cav = G.createRadialGradient(m.x - m.r * .16, m.y - m.r * .12, 6, m.x, m.y, m.r * .9); cav.addColorStop(0, '#2c251b'); cav.addColorStop(.7, '#171108'); cav.addColorStop(1, '#0a0704');
  G.fillStyle = cav; G.beginPath(); G.ellipse(m.x, m.y, m.r * .82, m.r * .46, 0, 0, 7); G.fill();
  // ── ground-powder heap accumulating in the bowl ──
  const frac = g.pieces.length ? g.groundCount / g.pieces.length : 0;
  if (frac > 0) {
    const hy = m.y + m.r * .12, hw = m.r * .66 * Math.sqrt(frac), hh = m.r * .2 * frac;
    const heap = G.createLinearGradient(m.x, hy - hh, m.x, hy + hh); heap.addColorStop(0, shade(tint, 26)); heap.addColorStop(1, shade(tint, -32));
    G.fillStyle = heap; G.beginPath(); G.ellipse(m.x, hy, hw, hh, 0, 0, 7); G.fill();
    for (let i = 0; i < 34 * frac; i++) { G.fillStyle = i % 3 ? shade(tint, 20) : shade(tint, -26); G.fillRect(m.x + rnd(hw, -hw) * .9, hy + rnd(hh, -hh) * .8, 1.4, 1.4); }
  }
  // ── loose pieces (leaves or tablets), or the whole nugget waiting to be cracked ──
  if (!g.nuggetBroken) {
    const c = g.nugget, pulse = 1 + Math.sin(t * 3) * .03; G.save(); G.translate(c.x, c.y); G.scale(pulse, pulse);
    G.fillStyle = 'rgba(0,0,0,.4)'; G.beginPath(); G.ellipse(0, c.r * .55, c.r * .95, c.r * .4, 0, 0, 7); G.fill();
    const ng = G.createRadialGradient(-c.r * .3, -c.r * .32, 4, 0, 0, c.r); ng.addColorStop(0, shade(tint, 52)); ng.addColorStop(.6, shade(tint, -4)); ng.addColorStop(1, shade(tint, -48));
    G.fillStyle = ng; blob(0, 0, c.r, c.r * .92, t * .6); G.fill();
    for (let k = 0; k < 7; k++) { G.save(); G.rotate(k / 7 * Math.PI * 2 + t * .1); G.fillStyle = shade(tint, k % 2 ? 16 : -22); G.beginPath(); G.ellipse(0, -c.r * .42, c.r * .15, c.r * .42, 0, 0, 7); G.fill(); G.strokeStyle = 'rgba(0,0,0,.25)'; G.lineWidth = 1; G.beginPath(); G.moveTo(0, -c.r * .8); G.lineTo(0, -c.r * .04); G.stroke(); G.restore(); }
    G.strokeStyle = 'rgba(230,245,200,.5)'; G.lineWidth = 1.6; blob(0, 0, c.r, c.r * .92, t * .6); G.stroke();
    G.fillStyle = 'rgba(255,255,255,.3)'; G.beginPath(); G.ellipse(-c.r * .3, -c.r * .36, c.r * .28, c.r * .15, -.5, 0, 7); G.fill();
    G.restore();
    G.save(); G.globalAlpha = .35 + .35 * Math.sin(t * 3); G.strokeStyle = tint; G.lineWidth = 1.5; G.setLineDash([5, 6]); G.beginPath(); G.arc(c.x, c.y, c.r + 12, 0, 7); G.stroke(); G.setLineDash([]); G.restore();
  } else {
    g.pieces.forEach(pc => { if (pc.ground || pc.r <= 0) return; G.save(); G.translate(pc.x, pc.y + pc.fall);
      if (isLeaf) { G.rotate(Math.sin(pc.x * 0.3) * .6); drawLeafBit(pc.r, tint); } else drawTabletBit(pc.r, tint); G.restore(); });
  }
  // rim light drawn over the contents so the near lip reads in front
  G.strokeStyle = 'rgba(214,192,150,.55)'; G.lineWidth = 3; G.beginPath(); G.ellipse(m.x, m.y, m.r * .82, m.r * .46, 0, Math.PI * 1.04, Math.PI * 1.96); G.stroke();
  G.strokeStyle = 'rgba(0,0,0,.45)'; G.lineWidth = 2.5; G.beginPath(); G.ellipse(m.x, m.y, m.r * .82, m.r * .46, 0, Math.PI * .06, Math.PI * .94); G.stroke();
  // ── dust puffs ──
  g.grindDust.forEach(d => { G.globalAlpha = clamp(1 - d.life / d.ttl, 0, 1); G.fillStyle = d.col; G.fillRect(d.x, d.y, 2, 2); }); G.globalAlpha = 1;
  // ── weighted stone pestle at the cursor (grip up, bulb working the bowl) ──
  G.save(); G.translate(g.pestle.x, g.pestle.y); if (g.pestle.active) G.rotate(Math.sin(t * 32) * .05);
  G.fillStyle = 'rgba(0,0,0,.3)'; G.beginPath(); G.ellipse(0, 13, 20, 7, 0, 0, 7); G.fill();
  const grip = G.createLinearGradient(-7, 0, 9, 0); grip.addColorStop(0, '#6e6146'); grip.addColorStop(.5, '#c9b98c'); grip.addColorStop(1, '#5b4f38');
  G.fillStyle = grip; roundRect(-6, -52, 12, 46, 5); G.fill();
  const head = G.createRadialGradient(-5, -6, 3, 0, 0, 19); head.addColorStop(0, '#e8d8ab'); head.addColorStop(.6, '#b9a877'); head.addColorStop(1, '#6e6146');
  G.fillStyle = head; G.beginPath(); G.ellipse(0, 0, 17, 15, 0, 0, 7); G.fill();
  G.strokeStyle = 'rgba(0,0,0,.4)'; G.lineWidth = 2; G.beginPath(); G.ellipse(0, 0, 17, 15, 0, 0, 7); G.stroke();
  G.fillStyle = 'rgba(255,255,255,.4)'; G.beginPath(); G.ellipse(-5, -5, 6, 4, -.5, 0, 7); G.fill();
  G.restore();
  hud(g, label);
  G.save(); textShadowOn(); G.fillStyle = brightCol(); G.font = 'bold 12px monospace'; G.textAlign = 'center';
  G.fillText(g.nuggetBroken ? `HOLD & DRAG THE PESTLE OVER THE PIECES — ${g.groundCount}/${g.pieces.length} GROUND` : 'CLICK THE NUGGET TO CRACK IT', W / 2, m.y + m.r + 34);
  G.restore();
}
function grindExit() { AX.stop('grind'); }
// after full grind: a short "add the binding liquid" beat before quench.
function toLiquidBeat(g) { if (g.phase !== 'work') return; g.phase = 'liquid'; g.liquidT = 0; grindExit(); g.lab.ticker('add the binding liquid…'); }
function drawLiquidBeat(g) {
  const m = g.mortar, t = clamp(g.liquidT / 1, 0, 1);
  G.save(); G.globalAlpha = Math.min(1, t * 2); G.fillStyle = 'rgba(120,200,230,.55)'; G.beginPath(); G.ellipse(m.x, m.y - 50 + t * 46, 7, 58 * (1 - t * .5), 0, 0, 7); G.fill(); G.restore();
  G.save(); textShadowOn(); G.fillStyle = brightCol(); G.font = 'bold 14px monospace'; G.textAlign = 'center'; G.fillText('ADDING BINDING LIQUID…', W / 2, m.y - m.r - 20); G.restore();
}

// ── BLOT — dose a perforated paper sheet (botanical/blotter) ──────────────────
// A grid of tabs on a sheet; a loaded dropper trails the cursor. Hold and drag
// over each tab to soak it — every tab wants an EVEN dose: land it near full and
// MOVE ON. Linger and it over-bleeds (blotches darker + wider), costing quality.
// Once every tab is dosed the sheet is dried & perforated at the quench.
function blotInit(g, tint) {
  const cols = 5, rows = 4, cw = 72, ch = 58, sw = cols * cw, sh = rows * ch;
  g.sheet = { cols, rows, cw, ch, sw, sh, x: W / 2 - sw / 2, y: H * 0.5 - sh / 2 + 6 };
  g.tabs = Array.from({ length: cols * rows }, () => ({ soak: 0, done: false }));
  g.dropper = { x: W / 2, y: H * 0.28, active: false };
  g.blotTint = tint || 'rgba(150,120,210,.95)';
  AX.loop('drip', { freq: 62, type: 'sine', gain: 0, filt: 320, tremRate: 6, tremDepth: .4 });
}
function blotMove(g, p) { g.dropper.x = p.x; g.dropper.y = p.y; }
function blotInput(g, down) { g.dropper.active = down; }
function blotTabUnder(g) { const s = g.sheet, cx = Math.floor((g.dropper.x - s.x) / s.cw), cy = Math.floor((g.dropper.y - s.y) / s.ch);
  if (cx < 0 || cy < 0 || cx >= s.cols || cy >= s.rows) return -1; return cy * s.cols + cx; }
function blotUpdate(g, dt) {
  AX.loopGain('drip', g.dropper.active ? .045 : 0);
  if (g.dropper.active) { const i = blotTabUnder(g); if (i >= 0) { const tb = g.tabs[i]; tb.soak = clamp(tb.soak + dt * 0.85, 0, 1.7);
    if (!tb.done && tb.soak >= 0.82) { tb.done = true; AX.tick(); } } }
  if (g.tabs.every(tb => tb.soak >= 0.82)) {
    // quality peaks at soak≈1; under- OR over-soaking both bleed off score.
    g.workScore = g.tabs.reduce((a, tb) => a + clamp(1 - Math.abs(tb.soak - 1) / 0.6, 0, 1), 0) / g.tabs.length;
    toQuench(g, 'dry & perforate the sheet');
  }
}
function blotExit() { AX.stop('drip'); }
function blotDraw(g, label, tint) {
  const s = g.sheet, t = g.bgT || 0;
  // ── paper sheet: cast shadow, cream stock, torn-tan border ──
  G.save(); G.fillStyle = 'rgba(0,0,0,.34)'; G.beginPath(); G.ellipse(s.x + s.sw / 2, s.y + s.sh + 16, s.sw * .55, 20, 0, 0, 7); G.fill(); G.restore();
  const pg = G.createLinearGradient(s.x, s.y, s.x, s.y + s.sh); pg.addColorStop(0, 'rgba(246,242,230,.97)'); pg.addColorStop(1, 'rgba(212,206,188,.93)');
  G.fillStyle = pg; roundRect(s.x - 7, s.y - 7, s.sw + 14, s.sh + 14, 4); G.fill();
  // ── per-tab dose blotches (drug-tinted; over-soak darkens + wicks past the cell) ──
  for (let cy = 0; cy < s.rows; cy++) for (let cx = 0; cx < s.cols; cx++) {
    const i = cy * s.cols + cx, tb = g.tabs[i], px = s.x + cx * s.cw + s.cw / 2, py = s.y + cy * s.ch + s.ch / 2;
    if (tb.soak > 0.01) { const over = clamp(tb.soak - 1, 0, .7), rr = Math.min(s.cw, s.ch) * (.28 + tb.soak * .17);
      G.save(); G.globalAlpha = clamp(tb.soak, .2, .95);
      const bg = G.createRadialGradient(px, py, 1, px, py, rr); bg.addColorStop(0, shade(tint, 20 - over * 70)); bg.addColorStop(1, shade(tint, -30 - over * 80));
      G.fillStyle = bg; G.beginPath(); G.ellipse(px, py, rr, rr * .92, 0, 0, 7); G.fill(); G.restore(); }
    // faint printed motif on each dry tab
    if (tb.soak < 0.3) { G.save(); G.globalAlpha = .18; G.strokeStyle = shade(tint, -20); G.lineWidth = 1; G.beginPath(); G.arc(px, py, 7, 0, 7); G.moveTo(px - 5, py); G.lineTo(px + 5, py); G.moveTo(px, py - 5); G.lineTo(px, py + 5); G.stroke(); G.restore(); }
    // "dosed" pip when a tab is in the sweet zone
    if (tb.done) { G.fillStyle = tb.soak > 1.25 ? '#e0644f' : '#4fe08a'; G.beginPath(); G.arc(px + s.cw / 2 - 7, py - s.ch / 2 + 7, 2.2, 0, 7); G.fill(); }
  }
  // ── perforation grid (dashed) + border ──
  G.strokeStyle = 'rgba(120,110,90,.45)'; G.lineWidth = .8; G.setLineDash([1.5, 3]);
  for (let i = 1; i < s.cols; i++) { G.beginPath(); G.moveTo(s.x + i * s.cw, s.y); G.lineTo(s.x + i * s.cw, s.y + s.sh); G.stroke(); }
  for (let i = 1; i < s.rows; i++) { G.beginPath(); G.moveTo(s.x, s.y + i * s.ch); G.lineTo(s.x + s.sw, s.y + i * s.ch); G.stroke(); }
  G.setLineDash([]); G.strokeStyle = 'rgba(120,110,90,.5)'; G.lineWidth = 1.2; roundRect(s.x, s.y, s.sw, s.sh, 2); G.stroke();
  // ── loaded dropper trailing the cursor ──
  const dp = g.dropper; G.save(); G.translate(dp.x, dp.y); G.rotate(0.35);
  G.fillStyle = 'rgba(0,0,0,.25)'; G.beginPath(); G.ellipse(2, 40, 8, 4, 0, 0, 7); G.fill();
  G.fillStyle = 'rgba(200,220,225,.22)'; roundRect(-6, -46, 12, 40, 5); G.fill();
  G.fillStyle = tint; G.fillRect(-4, -22, 8, 16);   // reservoir of loaded solution
  G.strokeStyle = 'rgba(220,235,240,.6)'; roundRect(-6, -46, 12, 40, 5); G.stroke();
  G.fillStyle = '#2a343a'; roundRect(-7, -56, 14, 12, 3); G.fill();
  G.fillStyle = tint; G.beginPath(); G.moveTo(-3, -6); G.lineTo(3, -6); G.lineTo(0, 4); G.closePath(); G.fill();   // pending drop at the tip
  if (dp.active) { G.fillStyle = tint; G.beginPath(); G.arc(0, 12 + (t * 60 % 20), 2.4, 0, 7); G.fill(); }
  G.restore();
  hud(g, label);
  const dosed = g.tabs.filter(tb => tb.done).length;
  G.save(); textShadowOn(); G.fillStyle = brightCol(); G.font = 'bold 12px monospace'; G.textAlign = 'center';
  G.fillText(`HOLD & DRAG THE DROPPER — DOSE EACH TAB EVENLY · ${dosed}/${g.tabs.length}`, W / 2, s.y + s.sh + 34); G.restore();
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
    init(g) { if (g.opts.form === 'leaf') grindInit(g, true, 'rgba(150,190,110,.95)');
      else if (g.opts.form === 'blotter') blotInit(g, 'rgba(150,120,210,.95)');
      else { bandInit(g, { dur: 14, gravity: 0.55, push: 1.15, bandHalf: clamp(.26 - g.difficulty * .006, .15, .26), bandSpeed: .06 + g.difficulty * .01 }); AX.loop('burner', { freq: 58, type: 'sine', gain: .025, filt: 380, tremRate: 5, tremDepth: .2 }); } },
    update(g, dt) { const f = g.opts.form; f === 'leaf' ? grindUpdate(g, dt) : f === 'blotter' ? blotUpdate(g, dt) : bandUpdate(g, dt, () => toQuench(g, 'press and jar it')); },
    input(g, down, p) { const f = g.opts.form; if (f === 'leaf') grindInput(g, down, p); else if (f === 'blotter') blotInput(g, down); else g.hold = down; },
    move(g, p) { const f = g.opts.form; if (f === 'leaf') grindMove(g, p); else if (f === 'blotter') blotMove(g, p); },
    draw(g) { const f = g.opts.form; return f === 'leaf' ? grindDraw(g, 'CURE — GRIND THE NUGGET', 'rgba(150,190,110,.55)') : f === 'blotter' ? blotDraw(g, 'DOSE — SOAK THE TABS', 'rgba(150,120,210,.9)') : drawBandGame(g, { burner: false, steam: false, flecks: true, okCol: '#7fbf5a', stat: (x) => `CURED ${Math.round(x.inBand / Math.max(.001, x.t) * 100)}% · ${Math.max(0, x.dur - x.t).toFixed(1)}s` }); },
    exit(g) { const f = g.opts.form; if (f === 'leaf') grindExit(); else if (f === 'blotter') blotExit(); else AX.stop('burner'); },
  },
  solids: {
    accent: '#ffb23e', label: 'PRESS — hold to build force, release in the green (×3)',
    init(g) { if (g.opts.form === 'pill') grindInit(g, false, 'rgba(224,224,230,.95)');
      else { g.pressIdx = 0; g.presses = 3; g.force = 0; g.rising = false; g.scores = []; g.target = .6; g.band = clamp(.14 - g.difficulty * .005, .06, .14); g.rate = 0.5 + g.difficulty * .04; } },
    update(g, dt) { if (g.opts.form === 'pill') { grindUpdate(g, dt); return; } if (g.rising) { g.force += dt * g.rate; if (g.force >= 1.08) this.lock(g, true); } },
    lock(g, over) { g.rising = false; const acc = over ? 0 : clamp(1 - Math.abs(g.force - g.target) / (g.band * 2.4), 0, 1); g.scores.push(acc); g.pressIdx++; g.force = 0;
      if (over) AX.bad(); else if (acc > .85) AX.perfect(); else if (acc > .5) AX.good(); else AX.click();
      if (g.pressIdx >= g.presses) { g.workScore = g.scores.reduce((a, b) => a + b, 0) / g.scores.length; toQuench(g, 'seal the tablets'); } },
    input(g, down, p) { if (g.opts.form === 'pill') { grindInput(g, down, p); return; } if (down) { if (!g.rising && g.pressIdx < g.presses) g.rising = true; } else if (g.rising) this.lock(g, false); },
    move(g, p) { if (g.opts.form === 'pill') grindMove(g, p); },
    draw(g) { g.opts.form === 'pill' ? grindDraw(g, 'PRESS — GRIND THE PILLS', 'rgba(220,220,225,.6)') : drawSolidsGame(g); },
    exit(g) { if (g.opts.form === 'pill') grindExit(); },
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

// Dev form-changer (cooktest): every FORM maps to one of the four family minigames.
const FORM_FAMILY = { liquid: 'wet', gel: 'wet', paste: 'wet', powder: 'solids', pill: 'solids', crystal: 'solids', gas: 'gas', leaf: 'botanical', blotter: 'botanical' };
const TEST_FORMS = ['liquid', 'gel', 'paste', 'powder', 'pill', 'crystal', 'gas', 'leaf', 'blotter'];
const DEFAULT_FORM = { wet: 'liquid', solids: 'powder', gas: 'gas', botanical: 'leaf' };
// A bottom toolbar of the nine forms — click one to relaunch the test on its family
// minigame. Present only in dev cooktest.
function buildFormChanger(g) {
  const cur = g.opts.form || DEFAULT_FORM[g.family];
  const w = 66, gap = 6, n = TEST_FORMS.length, x0 = (W - (n * w + (n - 1) * gap)) / 2;
  TEST_FORMS.forEach((f, i) => {
    const b = g.lab.mkBtn(f, `left:${Math.round(x0 + i * (w + gap))}px;bottom:40px;min-width:${w}px;padding:5px 2px;font-size:9px`, f === cur ? '' : 'ghost');
    b.onclick = () => { AX.click(); openSynthMinigame({ family: FORM_FAMILY[f], form: f, difficulty: g.difficulty, recipeName: 'TEST · ' + f.toUpperCase(), test: true, onResult: g.opts.onResult }); };
  });
}

export function openSynthMinigame(opts = {}) {
  closeSynth();
  const family = FAMILIES[opts.family] ? opts.family : 'wet';
  const fam = FAMILIES[family];
  const lab = mountLab({ title: 'CHIMERA-9', subtitle: 'COOK · ' + String(opts.recipeName || 'BATCH').toUpperCase(), accent: fam.accent, showInsta: false, test: !!opts.test });
  const d = clamp(opts.difficulty || 5, 1, 14);
  _g = { lab, opts, family, closed: false, phase: 'work', t: 0, last: performance.now(), raf: null, difficulty: d,
    workScore: 0, quenchT: 0, quenchTapped: false, quenchDur: 1.4, result: null, resultT: 0, _resolved: false, _label: fam.label, beaker: { x: W / 2, y: H * 0.48, w: 120, h: 220 } };
  fam.init(_g);
  wireCook(_g);
  if (opts.test) buildFormChanger(_g);
  _g.lab.ticker(fam.label);
  _g.raf = requestAnimationFrame(cookLoop);
}
function closeSynth() { if (_g && _g.lab) _g.lab.close(); }

function wireCook(g) {
  const canvas = g.lab.canvas;
  const onMove = e => { const p = evPos(canvas, e); if (g.phase === 'work' && FAMILIES[g.family].move) FAMILIES[g.family].move(g, p); };
  const onDown = e => { AX.tick(); const p = evPos(canvas, e); if (g.phase === 'work') FAMILIES[g.family].input(g, true, p); else if (g.phase === 'quench') quenchStrike(g); };
  const onUp = () => { if (g.phase === 'work') FAMILIES[g.family].input(g, false); };
  const onKey = e => { if (e.key === 'Escape') { g.lab.close(); return; } if (e.repeat) return; if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); if (g.phase === 'work') FAMILIES[g.family].input(g, true); else if (g.phase === 'quench') quenchStrike(g); } };
  const onKeyUp = e => { if (e.code === 'Space' || e.key === ' ') { if (g.phase === 'work') FAMILIES[g.family].input(g, false); } };
  canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerdown', onDown); window.addEventListener('pointerup', onUp); window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKeyUp);
  g.lab.onClose(() => { g.closed = true; canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerdown', onDown); window.removeEventListener('pointerup', onUp); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); if (g.raf) cancelAnimationFrame(g.raf); FAMILIES[g.family] && FAMILIES[g.family].exit(g); });
}

function toQuench(g, label) { if (g.phase !== 'work' && g.phase !== 'liquid') return; const wasWork = g.phase === 'work'; g.phase = 'quench'; g.quenchT = 0; g.quenchTapped = false; if (wasWork) FAMILIES[g.family].exit(g); g.lab.ticker(`${label} — strike SPACE as the ring meets the mark.`); }

function cookLoop(now) {
  const g = _g; if (!g || g.closed) return;
  let dt = (now - g.last) / 1000; g.last = now; if (dt > .05) dt = .05;
  if (g.phase === 'work') g.t += dt;
  g.bgT = (g.bgT || 0) + dt;   // always-advancing clock for ambient motion (g.t freezes off-work)
  update(g, dt);
  G.clearRect(0, 0, W, H); drawBench();
  lightShaft(W / 2, 70, 340, H * 0.7, '130,225,175', .05);   // shared bench atmosphere (as splice)
  dustMotes(g.bgT, 42, '150,225,185');
  FAMILIES[g.family].draw(g);
  if (g.phase !== 'done') {
    // CHIMERA-9 status readout
    drawLCD(W - 152, 18, 132, 24, (g._label || 'SYNTH').toUpperCase(), '#5fd0e0', 'CHIMERA-9');
    if (g.opts.test) { G.save(); textShadowOn(); G.fillStyle = brightCol(); G.font = 'bold 13px monospace'; G.textAlign = 'center'; G.fillText('DEV · CHANGE FORM ↓', W / 2, H - 76); G.restore(); }
  }
  if (g.phase === 'liquid') drawLiquidBeat(g);
  if (g.phase === 'quench') drawQuench(g);
  if (g.phase === 'done') drawDone(g);
  g.raf = requestAnimationFrame(cookLoop);
}
function update(g, dt) {
  if (g.phase === 'work') FAMILIES[g.family].update(g, dt);
  else if (g.phase === 'liquid') { g.liquidT += dt; if (g.liquidT > 1) toQuench(g, 'quench and set the batch'); }
  else if (g.phase === 'quench') { g.quenchT += dt; if (g.quenchT > g.quenchDur && !g.quenchTapped) finishCook(g, 'MISS', -0.08); }
  else if (g.phase === 'done') { g.resultT += dt; if (g.resultT > 1.15 && !g._resolved) { g._resolved = true;
    if (g.opts.test) { openSynthMinigame({ family: g.family, form: g.opts.form, difficulty: g.difficulty, recipeName: g.opts.recipeName, test: true, onResult: g.opts.onResult }); return; }  // dev loop — replay so you can keep switching forms
    const cb = g.opts.onResult, score = g.result.score; g.lab.close(); if (cb) cb({ score }); } }
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
function hud(g, text) { G.save(); textShadowOn(); G.textAlign = 'center'; G.fillStyle = dimCol(); G.font = 'bold 13px monospace'; G.fillText(g._label || '', W / 2, 50); G.fillStyle = brightCol(); G.font = 'bold 16px monospace'; G.fillText(text, W / 2, 68); G.restore(); }
function drawQuench(g) {
  const cx = W / 2, cy = H * 0.44, R0 = 150, Rt = 34, R = R0 * (1 - clamp(g.quenchT / g.quenchDur, 0, 1));
  G.strokeStyle = 'rgba(79,224,138,.8)'; G.lineWidth = 3; G.beginPath(); G.arc(cx, cy, Rt, 0, 7); G.stroke();
  if (R > 2 && !g.quenchTapped) { G.strokeStyle = `rgba(95,208,224,${clamp(R / R0 + .2, .3, 1)})`; G.lineWidth = 2.5; G.beginPath(); G.arc(cx, cy, R, 0, 7); G.stroke(); }
  G.save(); textShadowOn(); G.fillStyle = brightCol(); G.font = 'bold 13px monospace'; G.textAlign = 'center'; G.fillText('◄ SET ON THE MARK ►', cx, cy - Rt - 12); G.restore();
}
function drawDone(g) {
  const win = g.result.score >= 60; G.save(); G.textAlign = 'center'; textShadowOn(6);
  G.fillStyle = win ? '#4fe08a' : '#e0b64f'; G.font = 'bold 22px monospace'; G.shadowColor = win ? 'rgba(79,224,138,.7)' : 'rgba(224,182,79,.6)'; G.shadowBlur = 14;
  G.fillText(`${g.result.grade} — ${g.result.score}%`, W / 2, H * 0.2); G.shadowBlur = 0;
  textShadowOn(); G.fillStyle = dimCol(); G.font = 'bold 12px monospace'; G.fillText(g.result.score >= 75 ? 'CLEAN BATCH' : g.result.score >= 45 ? 'PASSABLE' : 'MESSY', W / 2, H * 0.2 + 18); G.restore();
}

// ── per-family renderers ─────────────────────────────────────────────────────
// viscosity dressing painted over the band fill (inside the beaker clip): gel clings
// up the walls with a glassy domed meniscus; paste heaps into a dull, stiff crust.
function drawWetSurface(b, ly, base, col, form) {
  const x0 = b.x - b.w / 2, w = b.w, xr = b.x + b.w / 2;
  if (form === 'gel') {
    G.save();
    const cl = 16; for (const wx of [x0, xr - 4]) { const cg = G.createLinearGradient(0, ly - cl, 0, ly + 4); cg.addColorStop(0, 'rgba(255,255,255,0)'); cg.addColorStop(1, shade(col, 30)); G.fillStyle = cg; G.globalAlpha = .35; G.fillRect(wx, ly - cl, 4, cl + 6); }
    G.globalAlpha = 1; G.strokeStyle = 'rgba(255,255,255,.28)'; G.lineWidth = 2; G.beginPath();
    for (let px = x0 + 2; px <= xr - 2; px += 4) { const yy = ly + 3 - Math.sin((px - x0) / w * Math.PI) * 5; px === x0 + 2 ? G.moveTo(px, yy) : G.lineTo(px, yy); } G.stroke();
    const gg = G.createRadialGradient(b.x - 6, ly + 18, 2, b.x, ly + 26, w * .7); gg.addColorStop(0, 'rgba(255,255,255,.14)'); gg.addColorStop(1, 'rgba(255,255,255,0)'); G.fillStyle = gg; G.fillRect(x0, ly, w, base - ly);
    G.restore();
  } else if (form === 'paste') {
    G.save();
    G.fillStyle = 'rgba(30,28,24,.16)'; G.fillRect(x0, ly, w, base - ly);   // matte veil kills the shine
    const mg = G.createLinearGradient(0, ly - 6, 0, ly + 12); mg.addColorStop(0, shade(col, -6)); mg.addColorStop(1, shade(col, -30));
    G.fillStyle = mg; G.beginPath(); G.moveTo(x0, ly + 8);
    for (let px = x0; px <= xr; px += 6) G.lineTo(px, ly + 2 - Math.abs(Math.sin(px * 0.21 + 1.3)) * 6 - Math.cos(px * 0.11) * 2);
    G.lineTo(xr, ly + 8); G.closePath(); G.fill();
    for (let i = 0; i < 4; i++) { G.fillStyle = shade(col, i % 2 ? 10 : -22); G.beginPath(); G.arc(x0 + 12 + i * (w - 24) / 3, ly + 2 + (i % 2) * 4, 3 + (i % 3), 0, 7); G.fill(); }
    G.globalAlpha = .5; for (const wx of [x0, xr - 5]) { G.fillStyle = shade(col, -18); G.fillRect(wx, ly - 4, 5, base - ly + 4); } G.globalAlpha = 1;
    G.restore();
  }
}
function drawBandGame(g, o) {
  const b = g.beaker, base = b.y + b.h / 2, ly = base - g.level * (b.h * 0.7);
  const form = g.opts.form, visc = form === 'paste' ? .28 : form === 'gel' ? .5 : 1;   // 1 = runny
  const slosh = clamp(Math.abs(g.vel) * 0.5, 0, 1) * visc;
  if (o.burner) drawBurner(b, g.heatS, g.t);
  drawBeaker(b, () => {
    const c = bandCenter(g), inb = Math.abs(g.level - c) <= g.bandHalf, col = inb ? o.okCol : (g.level > c ? '#e0b64f' : '#e0644f');
    fillLiquid(b.x - b.w / 2, b.w, ly, base, col, col, g.t, slosh, g.heatS);
    drawWetSurface(b, ly, base, col, form);
    const bt = base - (c + g.bandHalf) * (b.h * 0.7), bb = base - (c - g.bandHalf) * (b.h * 0.7);
    G.fillStyle = inb ? 'rgba(90,255,150,.16)' : 'rgba(90,255,150,.07)'; G.fillRect(b.x - b.w / 2, bt, b.w, bb - bt);
    G.strokeStyle = 'rgba(120,255,170,.6)'; G.setLineDash([5, 4]); G.lineWidth = 1; G.beginPath(); G.moveTo(b.x - b.w / 2, bt); G.lineTo(b.x + b.w / 2, bt); G.moveTo(b.x - b.w / 2, bb); G.lineTo(b.x + b.w / 2, bb); G.stroke(); G.setLineDash([]);
    if (o.flecks) for (let i = 0; i < 10; i++) { G.fillStyle = shade(o.okCol, -20); const fx = b.x + Math.sin(g.t * 1.5 + i) * b.w * .3, fy = ly + ((i * 17 + g.t * 10) % Math.max(1, base - ly)); G.save(); G.translate(fx, fy); G.rotate(i); G.fillRect(-2, -1, 4, 2); G.restore(); }
    g.bubbles.forEach(bl => { G.fillStyle = 'rgba(220,255,235,.3)'; G.beginPath(); G.arc(b.x + bl.x * b.w * .35, base - bl.y * (base - ly), bl.r, 0, 7); G.fill(); });
  });
  if (o.steam) drawSteam(b.x, ly, g.heatS * 0.9, g.t, '210,255,225');
  const tag = form === 'paste' ? 'THICK PASTE — heats slow, holds steady' : form === 'gel' ? 'VISCOUS GEL — sluggish, clings' : form === 'liquid' ? 'THIN LIQUID — runny, quick to swing' : '';
  if (tag) { G.save(); textShadowOn(); G.fillStyle = dimCol(); G.font = 'bold 11px monospace'; G.textAlign = 'center'; G.fillText(tag, b.x, base + 24); G.restore(); }
  hud(g, o.stat(g));
}
// the raw charge sitting in the die — powder packs into a fine mound, crystal into
// chunky shards; both flatten toward a puck as the ram bears down (compress 0..1).
function drawPressCharge(cx, bedY, dieW, compress, form, tint) {
  const maxH = 28, h = Math.max(3, maxH * (1 - compress * 0.62)), w = dieW * (0.52 + compress * 0.15);
  G.save(); G.beginPath(); G.rect(cx - dieW / 2 + 3, bedY - maxH - 4, dieW - 6, maxH + 4); G.clip();
  if (form === 'crystal' && compress < 0.5) {
    for (let i = 0; i < 9; i++) { const sx = cx - w / 2 + (i + .5) / 9 * w, sy = bedY - 3 - ((i * 37) % Math.max(4, h - 3)), r = 5 + (i % 3) * 2;
      G.save(); G.translate(sx, sy); G.rotate((i * 1.3) % 3); G.fillStyle = shade(tint, i % 2 ? 28 : -18);
      G.beginPath(); G.moveTo(0, -r); G.lineTo(r * .6, 0); G.lineTo(0, r); G.lineTo(-r * .6, 0); G.closePath(); G.fill();
      G.strokeStyle = 'rgba(255,255,255,.4)'; G.lineWidth = .7; G.stroke(); G.restore(); }
  } else {
    const cg = G.createLinearGradient(0, bedY - h, 0, bedY); cg.addColorStop(0, shade(tint, 22)); cg.addColorStop(1, shade(tint, -30));
    G.fillStyle = cg; G.beginPath(); G.moveTo(cx - w / 2, bedY);
    for (let px = cx - w / 2; px <= cx + w / 2; px += 4) G.lineTo(px, bedY - h + Math.cos((px - cx) * 0.09) * 3 * (1 - compress));
    G.lineTo(cx + w / 2, bedY); G.closePath(); G.fill();
    for (let i = 0; i < 22; i++) { G.fillStyle = i % 3 ? shade(tint, 24) : shade(tint, -26); G.fillRect(cx + ((i * 53) % w) - w / 2, bedY - 2 - ((i * 29) % Math.max(2, h - 2)), 1.4, 1.4); }
  }
  G.restore();
}
function drawSolidsGame(g) {
  const cx = W / 2, bedY = H * 0.64, crownY = H * 0.15, colX = 96, colW = 26;
  const tint = g.opts.form === 'crystal' ? 'rgba(196,210,222,1)' : 'rgba(214,198,158,1)';
  // impact shock from a sharp force drop (release), derived — no extra state plumbing
  if (g._lastF === undefined) g._lastF = 0;
  if (g._lastF - g.force > 0.25) g._impT = g.bgT;
  g._lastF = g.force;
  const iAge = g.bgT - (g._impT ?? -9), impact = iAge >= 0 && iAge < .45 ? 1 - iAge / .45 : 0;

  // ── heavy bolted columns ──
  for (const sx of [cx - colX, cx + colX]) {
    const cg = G.createLinearGradient(sx - colW / 2, 0, sx + colW / 2, 0); cg.addColorStop(0, '#171d22'); cg.addColorStop(.5, '#3a444c'); cg.addColorStop(1, '#171d22');
    G.fillStyle = cg; G.fillRect(sx - colW / 2, crownY, colW, bedY - crownY + 20);
    G.fillStyle = 'rgba(255,255,255,.10)'; G.fillRect(sx - colW / 2 + 3, crownY, 3, bedY - crownY);
    for (let by = crownY + 24; by < bedY; by += 46) { G.fillStyle = '#10151a'; G.beginPath(); G.arc(sx, by, 4, 0, 7); G.fill(); G.strokeStyle = 'rgba(150,170,180,.4)'; G.lineWidth = 1; G.stroke(); }
  }
  // ── crown beam ──
  const halfW = colX + colW / 2 + 6;
  const crg = G.createLinearGradient(0, crownY - 6, 0, crownY + 28); crg.addColorStop(0, '#4a555d'); crg.addColorStop(1, '#20272d');
  G.fillStyle = crg; roundRect(cx - halfW, crownY - 6, halfW * 2, 34, 4); G.fill();
  G.fillStyle = 'rgba(255,255,255,.12)'; G.fillRect(cx - halfW, crownY - 6, halfW * 2, 3);

  const ramTop = crownY + 28, ramY = ramTop + clamp(g.force, 0, 1) * (bedY - 36 - ramTop);
  // hydraulic cylinder (fixed) + polished piston rod (extends with force)
  const cylW = 40; G.fillStyle = '#2b333a'; roundRect(cx - cylW / 2, ramTop, cylW, 46, 5); G.fill();
  G.strokeStyle = 'rgba(180,205,215,.4)'; G.lineWidth = 1.5; roundRect(cx - cylW / 2, ramTop, cylW, 46, 5); G.stroke();
  G.fillStyle = 'rgba(255,255,255,.14)'; G.fillRect(cx - cylW / 2 + 5, ramTop + 4, 4, 38);
  const rodTop = ramTop + 40; const rr = G.createLinearGradient(cx - 12, 0, cx + 12, 0); rr.addColorStop(0, '#5a646c'); rr.addColorStop(.5, '#aab4bc'); rr.addColorStop(1, '#454d54');
  G.fillStyle = rr; G.fillRect(cx - 11, rodTop, 22, Math.max(0, ramY - rodTop));
  // platen (ram head)
  const plg = G.createLinearGradient(0, ramY, 0, ramY + 22); plg.addColorStop(0, '#7b858d'); plg.addColorStop(1, '#2a3138');
  G.fillStyle = plg; roundRect(cx - 60, ramY, 120, 22, 3); G.fill();
  G.fillStyle = 'rgba(255,255,255,.18)'; G.fillRect(cx - 56, ramY + 3, 112, 3);
  G.fillStyle = 'rgba(0,0,0,.4)'; G.fillRect(cx - 60, ramY + 19, 120, 3);

  // ── die + charge on the bed ──
  const dieW = 108;
  G.fillStyle = '#20262b'; G.fillRect(cx - dieW / 2 - 8, bedY, dieW + 16, 20);
  G.fillStyle = '#12171b'; G.fillRect(cx - dieW / 2, bedY - 30, dieW, 30);
  drawPressCharge(cx, bedY, dieW, clamp(g.force, 0, 1), g.opts.form, tint);
  G.strokeStyle = 'rgba(150,170,180,.35)'; G.lineWidth = 2; G.strokeRect(cx - dieW / 2, bedY - 30, dieW, 30);
  G.fillStyle = '#171d22'; G.fillRect(cx - colX - 30, bedY + 18, (colX + 30) * 2, 16);

  // ── impact: shock ring + dust puff on release ──
  if (impact > 0) { G.save(); G.globalAlpha = impact * .8; G.strokeStyle = shade(tint, 40); G.lineWidth = 2 + impact * 2;
    G.beginPath(); G.ellipse(cx, bedY - 6, 40 + (1 - impact) * 64, 12 + (1 - impact) * 18, 0, 0, 7); G.stroke();
    G.globalAlpha = impact * .5; G.fillStyle = shade(tint, 12);
    for (let i = 0; i < 8; i++) { const a = -Math.PI + i / 8 * Math.PI, d = (1 - impact) * 72; G.beginPath(); G.arc(cx + Math.cos(a) * d, bedY - 8 - Math.abs(Math.sin(a)) * d * .5, 3 * impact + 1, 0, 7); G.fill(); }
    G.restore(); }

  // ── finished pucks on the ejection tray ──
  for (let i = 0; i < Math.min(g.pressIdx, g.presses); i++) { const px = cx - 40 + i * 26, py = bedY + 40;
    const pug = G.createLinearGradient(0, py - 5, 0, py + 5); pug.addColorStop(0, shade(tint, 20)); pug.addColorStop(1, shade(tint, -34));
    G.fillStyle = pug; G.beginPath(); G.ellipse(px, py, 11, 5, 0, 0, 7); G.fill();
    G.strokeStyle = 'rgba(0,0,0,.35)'; G.lineWidth = 1; G.stroke(); G.fillStyle = 'rgba(255,255,255,.3)'; G.beginPath(); G.ellipse(px - 3, py - 1.5, 4, 1.6, 0, 0, 7); G.fill(); }

  // ── recessed FORCE gauge (right) ──
  const gx = cx + colX + 44, gy = crownY + 22, gh = bedY - gy, inB = Math.abs(g.force - g.target) < g.band;
  drawLCD(gx - 8, gy - 32, 52, 22, `${Math.round(clamp(g.force, 0, 1.08) * 100)}`, inB ? '#4fe08a' : (g.force > g.target + g.band ? '#ff4a5b' : '#5fd0e0'), 'FORCE');
  const gbg = G.createLinearGradient(gx, 0, gx + 18, 0); gbg.addColorStop(0, '#04080a'); gbg.addColorStop(1, '#0c1519');
  roundRect(gx, gy, 18, gh, 5); G.fillStyle = gbg; G.fill(); G.strokeStyle = 'rgba(0,0,0,.6)'; G.lineWidth = 1.5; roundRect(gx, gy, 18, gh, 5); G.stroke();
  const by0 = gy + gh * (1 - (g.target + g.band)), bbh = gh * g.band * 2;
  G.fillStyle = 'rgba(79,224,138,.22)'; G.fillRect(gx + 1, by0, 16, bbh); G.strokeStyle = 'rgba(79,224,138,.8)'; G.setLineDash([3, 3]); G.strokeRect(gx + 1, by0, 16, bbh); G.setLineDash([]);
  G.fillStyle = 'rgba(255,74,91,.18)'; G.fillRect(gx + 1, gy, 16, gh * 0.08);
  const ny = gy + gh * (1 - clamp(g.force, 0, 1.08));
  G.fillStyle = inB ? '#4fe08a' : g.force > g.target + g.band ? '#ff4a5b' : '#5fd0e0'; G.shadowColor = G.fillStyle; G.shadowBlur = inB ? 10 : 4; G.fillRect(gx - 4, ny - 2, 26, 4); G.shadowBlur = 0;

  hud(g, `PRESS ${Math.min(g.pressIdx + 1, g.presses)} / ${g.presses}`);
  G.save(); textShadowOn(); G.fillStyle = brightCol(); G.font = 'bold 12px monospace'; G.textAlign = 'center';
  G.fillText(g.rising ? 'RELEASE IN THE GREEN' : 'HOLD TO BUILD FORCE', cx, bedY + 66); G.restore();
}
function drawGasGame(g) {
  const cx = W / 2, cy = H * 0.40, R = 104;
  // ── regulator body / pressure cylinder under the gauge ──
  const tw = 122, ty = cy + R - 4;
  const tg = G.createLinearGradient(cx - tw / 2, 0, cx + tw / 2, 0); tg.addColorStop(0, '#20272d'); tg.addColorStop(.5, '#5a656d'); tg.addColorStop(1, '#181d22');
  G.fillStyle = tg; roundRect(cx - tw / 2, ty, tw, 146, 14); G.fill();
  G.fillStyle = 'rgba(255,255,255,.12)'; G.fillRect(cx - tw / 2 + 10, ty + 8, 6, 126);
  G.fillStyle = 'rgba(95,208,224,.5)'; G.fillRect(cx - tw / 2, ty + 66, tw, 16); G.fillStyle = 'rgba(0,0,0,.4)'; G.fillRect(cx - tw / 2, ty + 66, tw, 3);
  // side valve wheel (spins a touch on each vent)
  G.save(); G.translate(cx + tw / 2 + 6, ty + 40); G.rotate(g.vent * 1.4);
  G.strokeStyle = 'rgba(180,200,210,.6)'; G.lineWidth = 3; G.beginPath(); G.arc(0, 0, 13, 0, 7); G.stroke();
  for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; G.beginPath(); G.moveTo(0, 0); G.lineTo(Math.cos(a) * 13, Math.sin(a) * 13); G.stroke(); }
  G.fillStyle = '#2a333a'; G.beginPath(); G.arc(0, 0, 4, 0, 7); G.fill(); G.restore();

  // ── gauge: steel bezel + dark dial face ──
  G.fillStyle = '#0c1114'; G.beginPath(); G.arc(cx, cy, R + 8, 0, 7); G.fill();
  const bez = G.createLinearGradient(cx - R, cy - R, cx + R, cy + R); bez.addColorStop(0, '#5a656d'); bez.addColorStop(.5, '#20272d'); bez.addColorStop(1, '#40474e');
  G.strokeStyle = bez; G.lineWidth = 9; G.beginPath(); G.arc(cx, cy, R + 3, 0, 7); G.stroke();
  const dial = G.createRadialGradient(cx - R * .3, cy - R * .3, 8, cx, cy, R); dial.addColorStop(0, '#12181c'); dial.addColorStop(1, '#070b0e');
  G.fillStyle = dial; G.beginPath(); G.arc(cx, cy, R, 0, 7); G.fill();

  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, span = a1 - a0;
  G.lineCap = 'round';
  G.strokeStyle = 'rgba(79,224,138,.75)'; G.lineWidth = 7; G.shadowColor = 'rgba(79,224,138,.6)'; G.shadowBlur = 8; G.beginPath(); G.arc(cx, cy, R - 16, a0 + span * (g.target - g.band), a0 + span * (g.target + g.band)); G.stroke(); G.shadowBlur = 0;
  G.strokeStyle = 'rgba(255,74,91,.8)'; G.beginPath(); G.arc(cx, cy, R - 16, a0 + span * 0.9, a1); G.stroke();
  G.lineCap = 'butt';
  for (let i = 0; i <= 10; i++) { const a = a0 + span * (i / 10), big = i % 5 === 0; G.strokeStyle = big ? 'rgba(200,225,230,.7)' : 'rgba(140,165,175,.45)'; G.lineWidth = big ? 2 : 1;
    G.beginPath(); G.moveTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6)); G.lineTo(cx + Math.cos(a) * (R - (big ? 16 : 11)), cy + Math.sin(a) * (R - (big ? 16 : 11))); G.stroke(); }
  // needle (+cast shadow) + hub
  const na = a0 + span * clamp(g.pressure, 0, 1.15), inB = Math.abs(g.pressure - g.target) <= g.band, nc = inB ? '#4fe08a' : (g.pressure > 0.9 ? '#ff4a5b' : '#5fd0e0');
  G.save(); G.translate(cx, cy);
  G.strokeStyle = 'rgba(0,0,0,.5)'; G.lineWidth = 4; G.beginPath(); G.moveTo(-Math.cos(na) * 12 + 2, -Math.sin(na) * 12 + 2); G.lineTo(Math.cos(na) * (R - 20) + 2, Math.sin(na) * (R - 20) + 2); G.stroke();
  G.strokeStyle = nc; G.shadowColor = nc; G.shadowBlur = inB ? 10 : 5; G.lineWidth = 3; G.beginPath(); G.moveTo(-Math.cos(na) * 12, -Math.sin(na) * 12); G.lineTo(Math.cos(na) * (R - 20), Math.sin(na) * (R - 20)); G.stroke(); G.shadowBlur = 0;
  G.fillStyle = '#c9d4da'; G.beginPath(); G.arc(0, 0, 8, 0, 7); G.fill(); G.fillStyle = '#20262b'; G.beginPath(); G.arc(0, 0, 4, 0, 7); G.fill(); G.restore();
  // glass dome glint
  G.save(); G.globalCompositeOperation = 'lighter'; const gl = G.createLinearGradient(cx - R, cy - R, cx + R * .3, cy + R * .3); gl.addColorStop(0, 'rgba(255,255,255,.14)'); gl.addColorStop(.55, 'rgba(255,255,255,0)'); G.fillStyle = gl; G.beginPath(); G.arc(cx, cy, R, 0, 7); G.fill(); G.restore();

  // ── venting vapour + overpressure warning ──
  if (g.vent > 0.05) drawSteam(cx + tw / 2 - 4, ty + 74, g.vent * 1.1, g.t, '190,225,235');
  if (g.pressure > 0.92) { G.save(); G.globalAlpha = .35 + .35 * Math.sin(g.t * 18); textShadowOn(); G.fillStyle = '#ff4a5b'; G.font = 'bold 12px monospace'; G.textAlign = 'center'; G.fillText('⚠ OVERPRESSURE', cx, ty + 160); G.restore(); }
  hud(g, `PRESSURE ${Math.round(g.pressure * 100)} · TAP TO VENT · ${Math.max(0, g.dur - g.t).toFixed(1)}s`);
}

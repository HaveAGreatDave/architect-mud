// SYNTH LAB — the basic COOK minigame (the everyday synthesis, the lesser
// sibling of the SPLICE orchestra). Two beats on one screen:
//
//   1. STABILIZE — hold mouse / SPACE to feed the burner and keep the glowing
//      reagent inside a drifting green band (score = fraction of time in-band).
//   2. QUENCH    — the flame cuts, the beaker glows hot, and a ring collapses
//      onto a mark. One well-timed tap caps the batch for a small potency bonus.
//      (A miniature of the splice rhythm finale — cook is a single beat.)
//
// Launched by the `synth_minigame` server message (cook path). On finish,
// opts.onResult({score}) fires `synthresolve <recipeId> <score>`; the server
// rolls the authoritative chemistry check + bakes potency. Esc aborts (no
// resolve — reagents intact). Visuals come from lab-kit.js.

import {
  clamp, lerp, rnd, shade, G, W, H, drawBench, drawBeaker, drawBurner, fillLiquid, drawSteam, AX, mountLab,
} from './lab-kit.js';

let _g = null;

export function openSynthMinigame(opts = {}) {
  closeSynth();
  const lab = mountLab({ title: 'CHIMERA-9', subtitle: 'COOK · ' + String(opts.recipeName || 'COMPOUND').toUpperCase(), accent: '#4fe08a', showInsta: false });
  const d = clamp(opts.difficulty || 5, 1, 12);
  _g = {
    lab, opts, closed: false, phase: 'stabilize', t: 0, dur: 14, last: performance.now(), raf: null,
    difficulty: d, level: .5, vel: 0, hold: false, inBand: 0, heatS: 0, bubbles: [],
    gravity: 0.95 + d * .05, push: 1.9 + d * .05, bandHalf: clamp(.17 - d * .008, .06, .17), bandSpeed: .18 + d * .045,
    stabScore: 0, quenchT: 0, quenchTapped: false, quenchDur: 1.4, result: null, resultT: 0,
    beaker: { x: W / 2, y: H * 0.48, w: 120, h: 230 },
  };
  wireCook(_g);
  _g.lab.ticker('STABILIZE — hold mouse / SPACE to feed the burner. keep the reagent in the green band.');
  AX.loop('burner', { freq: 70, type: 'sawtooth', gain: .04, filt: 520, tremRate: 11, tremDepth: .35 });
  _g.raf = requestAnimationFrame(cookLoop);
}
function closeSynth() { if (_g && _g.lab) _g.lab.close(); }

function wireCook(g) {
  const canvas = g.lab.canvas;
  const onDown = () => { AX.tick(); if (g.phase === 'stabilize') g.hold = true; else if (g.phase === 'quench') quenchStrike(g); };
  const onUp = () => { g.hold = false; };
  const onKey = e => { if (e.key === 'Escape') { g.lab.close(); return; } if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); if (g.phase === 'stabilize') g.hold = true; else if (g.phase === 'quench') quenchStrike(g); } };
  const onKeyUp = e => { if (e.code === 'Space' || e.key === ' ') g.hold = false; };
  canvas.addEventListener('pointerdown', onDown); window.addEventListener('pointerup', onUp); window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKeyUp);
  g.lab.onClose(() => { g.closed = true; canvas.removeEventListener('pointerdown', onDown); window.removeEventListener('pointerup', onUp); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); if (g.raf) cancelAnimationFrame(g.raf); });
}

function band(g) { const c = .5 + (.5 - g.bandHalf) * .8 * Math.sin(g.t * g.bandSpeed * Math.PI * 2); return clamp(c, g.bandHalf, 1 - g.bandHalf); }

function cookLoop(now) {
  const g = _g; if (!g || g.closed) return;
  let dt = (now - g.last) / 1000; g.last = now; if (dt > .05) dt = .05;
  update(g, dt);
  G.clearRect(0, 0, W, H); drawBench(); draw(g);
  g.raf = requestAnimationFrame(cookLoop);
}

function update(g, dt) {
  if (g.phase === 'stabilize') {
    g.t += dt;
    g.vel += (g.hold ? g.push : -g.gravity) * dt; g.vel *= Math.pow(.06, dt); g.level = clamp(g.level + g.vel * dt, 0, 1);
    g.heatS += ((g.hold ? 1 : 0) - g.heatS) * Math.min(1, dt * 6); AX.loopGain('burner', .04 + g.heatS * .1);
    const c = band(g), inb = Math.abs(g.level - c) <= g.bandHalf; if (inb) g.inBand += dt;
    if (Math.random() < g.heatS * .6 + .05) g.bubbles.push({ x: rnd(1, -1), y: 0, r: rnd(3, 1), spd: rnd(1.4, .6) });
    g.bubbles.forEach(bl => bl.y += bl.spd * dt); g.bubbles = g.bubbles.filter(bl => bl.y < 1);
    g.lab.ticker(`STABLE ${Math.round(g.inBand / Math.max(.001, g.t) * 100)}% · ${Math.max(0, g.dur - g.t).toFixed(1)}s`);
    if (g.t >= g.dur) { g.stabScore = clamp(g.inBand / g.dur, 0, 1); g.phase = 'quench'; g.hold = false; AX.stop('burner'); g.lab.ticker('QUENCH — strike SPACE as the ring meets the mark.'); }
  } else if (g.phase === 'quench') {
    g.quenchT += dt; g.heatS = lerp(g.heatS, 0, dt * 2);
    if (g.quenchT > g.quenchDur && !g.quenchTapped) finishCook(g, 'MISS', -0.08);
  } else if (g.phase === 'done') {
    g.resultT += dt;
    if (g.resultT > 1.15 && !g._resolved) { g._resolved = true; const cb = g.opts.onResult, score = g.result.score; g.lab.close(); if (cb) cb({ score }); }
  }
}

function quenchStrike(g) {
  if (g.quenchTapped || g.phase !== 'quench') return; g.quenchTapped = true;
  const R = 150 * (1 - clamp(g.quenchT / g.quenchDur, 0, 1)), Rt = 34, err = Math.abs(R - Rt);
  const tol = 12 + (16 - g.difficulty); // more forgiving ring at low difficulty
  if (err < tol * 0.4) { AX.perfect(); g.lab.flash('#4fe08a'); finishCook(g, 'PERFECT', 0.12); }
  else if (err < tol) { AX.good(); finishCook(g, 'GOOD', 0.06); }
  else { AX.click(); finishCook(g, 'OFF', 0); }
}

function finishCook(g, grade, bonus) {
  if (g.phase === 'done') return;
  const score = clamp(Math.round((g.stabScore + bonus) * 100), 0, 100);
  g.result = { grade, score }; g.phase = 'done'; g.resultT = 0;
  AX.tone(score >= 60 ? 520 : 200, .3, { type: 'triangle', gain: .2, to: score >= 60 ? 760 : 120 });
}

function draw(g) {
  const b = g.beaker, base = b.y + b.h / 2, ly = base - g.level * (b.h * 0.7);
  const col = g.phase === 'stabilize' ? stabColor(g) : '#4fe08a';
  if (g.phase === 'stabilize') drawBurner(b, g.heatS, g.t);
  const slosh = clamp(Math.abs(g.vel) * 0.5, 0, 1);
  drawBeaker(b, () => {
    if (g.phase === 'stabilize') {
      const c = band(g), inb = Math.abs(g.level - c) <= g.bandHalf;
      fillLiquid(b.x - b.w / 2, b.w, ly, base, col, col, g.t, slosh, g.heatS);
      const bt = base - (c + g.bandHalf) * (b.h * 0.7), bb = base - (c - g.bandHalf) * (b.h * 0.7);
      G.fillStyle = inb ? 'rgba(90,255,150,.16)' : 'rgba(90,255,150,.07)'; G.fillRect(b.x - b.w / 2, bt, b.w, bb - bt);
      G.strokeStyle = 'rgba(120,255,170,.6)'; G.setLineDash([5, 4]); G.lineWidth = 1; G.beginPath(); G.moveTo(b.x - b.w / 2, bt); G.lineTo(b.x + b.w / 2, bt); G.moveTo(b.x - b.w / 2, bb); G.lineTo(b.x + b.w / 2, bb); G.stroke(); G.setLineDash([]);
      g.bubbles.forEach(bl => { G.fillStyle = 'rgba(220,255,235,.3)'; G.beginPath(); G.arc(b.x + bl.x * b.w * .35, base - bl.y * (base - ly), bl.r, 0, 7); G.fill(); });
    } else {
      // quench/done: a settled hot body of product, glowing
      const flash = g.phase === 'done' && g.result.grade !== 'MISS' && g.result.grade !== 'OFF';
      const glow = 0.4 + 0.3 * Math.sin(g.t * 4) + (flash ? 0.4 : 0);
      fillLiquid(b.x - b.w / 2, b.w, base - (b.h * 0.55), base, '#4fe08a', shade('#4fe08a', -30), g.t, 0.12, clamp(glow, 0, .7));
    }
  });
  if (g.phase === 'stabilize') { drawSteam(b.x, ly, g.heatS * 0.9, g.t, '210,255,225'); G.fillStyle = '#6f8a7c'; G.font = '10px monospace'; G.textAlign = 'center'; G.fillText('STABILIZE THE REACTION', b.x, b.y - b.h / 2 - 14); }
  else drawSteam(b.x, base - b.h * 0.5, 0.5, g.t, '210,255,225');

  if (g.phase === 'quench') drawQuench(g, b);
  if (g.phase === 'done') {
    const win = g.result.score >= 60; G.textAlign = 'center';
    G.fillStyle = win ? '#4fe08a' : '#e0b64f'; G.font = 'bold 17px monospace';
    G.fillText(`${g.result.grade} — ${g.result.score}%`, b.x, b.y - b.h / 2 - 18);
    G.fillStyle = '#6f8a7c'; G.font = '9px monospace'; G.fillText(g.result.score >= 75 ? 'CLEAN COOK' : g.result.score >= 45 ? 'PASSABLE' : 'MESSY', b.x, b.y - b.h / 2 - 2);
  }
}
function stabColor(g) { const c = band(g); return Math.abs(g.level - c) <= g.bandHalf ? '#4fe08a' : (g.level > c ? '#e0b64f' : '#e0644f'); }

function drawQuench(g, b) {
  const cx = b.x, cy = b.y - b.h / 2 - 66, R0 = 150, Rt = 34;
  const R = R0 * (1 - clamp(g.quenchT / g.quenchDur, 0, 1));
  // target mark
  G.strokeStyle = 'rgba(79,224,138,.8)'; G.lineWidth = 3; G.beginPath(); G.arc(cx, cy, Rt, 0, 7); G.stroke();
  G.strokeStyle = 'rgba(79,224,138,.25)'; G.lineWidth = 1; G.beginPath(); G.arc(cx, cy, Rt + 6, 0, 7); G.stroke();
  // collapsing ring
  if (R > 2 && !g.quenchTapped) { G.strokeStyle = `rgba(95,208,224,${clamp(R / R0 + .2, .3, 1)})`; G.lineWidth = 2.5; G.beginPath(); G.arc(cx, cy, R, 0, 7); G.stroke(); }
  G.fillStyle = '#6f8a7c'; G.font = '9px monospace'; G.textAlign = 'center'; G.fillText('◄ QUENCH ON THE MARK ►', cx, cy - Rt - 12);
}

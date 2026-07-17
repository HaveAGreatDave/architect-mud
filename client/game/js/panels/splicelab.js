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
  drawLCD,
  AX, mountLab, evPos, labBgLight, textShadowOn,
} from './lab-kit.js';

// canvas text assumes a dark backdrop by default; the lab can now sit on any theme
// (see lab-kit's labBgLight), so flip these hardcoded label palettes when it does.
const dimCol = () => labBgLight ? '#3f5148' : '#6f8a7c';
const brightCol = () => labBgLight ? '#173226' : '#cfe9d8';

// ── module state ─────────────────────────────────────────────────────────────
let game = null;                 // current session
let stage = null;                // current stage object (singleton)
let _stash = null;               // { selection, instability } carried select→stages
const ptr = { x: W / 2, y: H / 2, down: false };
const b64 = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const subFor = (f) => ({ liquid: 'thin', powder: 'fine', gel: 'viscous', pill: 'tablet' }[f] || 'thin');

// ── saved recipes (client-only, localStorage) ────────────────────────────────
// The splicer remembers compounds you've committed so you can recreate them
// without re-dragging the drugs. Purely a designer shortcut that pre-fills the
// slots — you still need the actual drugs + Stabilizer + skill on hand to run it,
// and nothing here touches the server. Mirrors the smartbar-macro storage model.
const RECIPES_KEY = 'architect.spliceRecipes.v1';
const RECIPES_MAX = 40;
function loadRecipes() {
  try { const a = JSON.parse(localStorage.getItem(RECIPES_KEY)); return Array.isArray(a) ? a : []; } catch { return []; }
}
function saveRecipes(list) {
  try { localStorage.setItem(RECIPES_KEY, JSON.stringify(list.slice(0, RECIPES_MAX))); } catch { /* private mode / quota — recipes just won't persist */ }
}
// Store newest-first, one entry per name (re-committing a name updates it).
function recordRecipe(rec) {
  if (!rec || !rec.name || !(rec.drugs || []).length) return;
  const key = rec.name.toLowerCase();
  const list = loadRecipes().filter(r => (r.name || '').toLowerCase() !== key);
  list.unshift(rec); saveRecipes(list);
}
function deleteRecipe(name) {
  const key = String(name || '').toLowerCase();
  saveRecipes(loadRecipes().filter(r => (r.name || '').toLowerCase() !== key));
}

// Effect summary for an info panel, redacted by how familiar the player is with
// the drug (learned by use). Unknown drugs read as a blur until you've dosed them.
function effText(d) {
  if ((d.known ?? 1) < 0.55) return 'effects unfamiliar —\nuse it more to read them';
  const b = d.blocks || {}, lines = [];
  if (b.instant) lines.push('• ' + b.instant);
  if (b.phases) lines.push('• ' + b.phases);
  if (b.hallucination) lines.push('• ' + b.hallucination);
  return lines.join('\n') || 'inert';
}
function redact(s, known) { if (known >= .75) return esc(s); if (known < .25) return `<span class="redact">${'█'.repeat(Math.min(22, Math.max(6, String(s).length)))}</span>`;
  return String(s).split('').map(c => (c === ' ' || Math.random() < known) ? esc(c) : '<span class="redact">█</span>').join(''); }

// per-form carry physics (spring freq Hz) + per-sub fluidity (slosh gain)
const FORM_FREQ = { liquid: 2.0, gel: 2.1, powder: 2.4, pill: 2.8, gas: 2.3, crystal: 2.9, blotter: 3.2, paste: 1.7, leaf: 2.6 };
const FORM_FLUID = { thin: 1, oil: 1, solvent: 1, fine: .28, crystalline: .22, viscous: .55, tablet: .06, pressurized: .5, shard: .05, sheet: .04, tar: .35, dried: .08 };

// Per-form pour physics — the DECANT/carry phase is about keeping a held vessel
// UPRIGHT. You never lose product just by sloshing in place; product only leaves
// when the vessel is TIPPED far enough that its contents climb over the lip. Tilt
// tracks how fast you sling it around (a hard snatch tips it near-horizontal → it
// dumps), so slow hands stay upright and lose nothing, a medium sweep tips it a
// little and bleeds a little, a fast yank pours it out. Sway rides the contents a
// bit higher up the wall on top of that. Two knobs per form:
//   • lip   — crest tolerance: how far the contents can climb the tipped wall
//     before they crest the rim (fuller/runnier = smaller lip = spills sooner).
//   • rate  — how fast it bleeds once it's over the lip.
// Gas is pressurised: it ALSO vents up out of the valve if you sling it past speedMax.
// All tunable — dial after feeling it in-game.
const SWAY_SENS = 1.7;      // JERK gain: a sudden change of speed slings the contents (mostly VISUAL slosh now)
const SWEEP_SPEED = 360;    // DEADZONE: below this carry speed, movement adds NO sway at all — slow is always safe
const SWEEP_GAIN = 0.012;   // a sustained fast sweep past SWEEP_SPEED keeps pushing sway up
const TILT_GAIN = 0.0016;   // how hard carry-speed tips the vessel — leans readily now, but still maxes at 0.7 (< any lip)
const TILT_CREST = 1.0;     // how much a full tip raises the contents at the lip
const SWAY_CREST = 0.28;    // sway barely counts toward crest now — you have to REALLY fling it
const POUR_DRAIN = 0.28;    // and even over the lip it only trickles out
const SPILL_INSTAB = 0.35;  // instability added per % of product lost
// Lips sit ABOVE the max reachable crest (tilt caps at 0.7), so a normal carry never
// spills — only a violent yank that pins full tilt AND slings heavy sway at once crosses,
// and then it bleeds slowly. Orders of magnitude more forgiving than a real vial.
const POUR_PHYS = {
  liquid:  { lip: 1.05, rate: 1.0 },                                // runniest — the least forgiving, but still needs a hard fling
  gel:     { lip: 1.28, rate: 0.6 },                                // viscous — clings to the glass
  paste:   { lip: 1.45, rate: 0.5 },                                // tar-thick — practically won't pour
  gas:     { lip: 1.10, rate: 1.2, ventUp: true, speedMax: 900 },   // pressurised — only vents if truly whipped around
  powder:  { lip: 1.18, rate: 0.9 },                                // fine — puffs over only on a hard jolt
  crystal: { lip: 1.35, rate: 0.7 },
  pill:    { lip: 1.60, rate: 0.5 },                                // tablets — rattle but essentially never spill
  leaf:    { lip: 1.08, rate: 1.0 },                                // light
  blotter: { lip: 1.65, rate: 0.4 },                                // paper tabs — rock stable
};
// Is the held vessel tipped past the point its contents crest the lip? `level` (the
// steadiness meter) reads crest/lip — 1.0 is right at the rim; `over` is how far past.
function pourHazard(p, spd) {
  const cfg = POUR_PHYS[p.d.form] || POUR_PHYS.liquid;
  const crest = Math.abs(p.tilt) * TILT_CREST + Math.abs(p.slosh) * SWAY_CREST;
  const tipR = crest / cfg.lip;
  const vent = cfg.ventUp ? Math.max(0, spd - (cfg.speedMax || 620)) / 260 : 0;   // gas also vents from raw speed
  const level = Math.max(tipR, vent);
  return { hazard: level > 1, over: Math.max(0, level - 1), level: clamp(level, 0, 1.3), ventUp: !!cfg.ventUp && vent > tipR, rate: cfg.rate || 1 };
}
// Bleed product out over the tipped lip (or up out of a vented valve). Shared by the
// SELECT cradle-carry and the DECANT carry — drains the vessel, streams drips from the
// lip, and books the loss + instability. `stage` supplies drips/lost/spillAlarm.
function bleedFromLip(stage, p, hz, dt) {
  const drain = hz.over * hz.rate * POUR_DRAIN * dt;              // fraction of the vessel out this frame
  const before = p.remaining ?? 1; p.remaining = Math.max(0, before - drain);
  const lost = (before - p.remaining) * 100;
  stage.lost += lost; addInstability(lost * SPILL_INSTAB, null);
  stage.spillAlarm();
  if (Math.random() < 0.6) {
    const dir = Math.sign(p.slosh || p.tilt || 1);
    stage.drips.push(hz.ventUp
      ? { x: p.x + rnd(10, -10), y: p.y - 26, vy: -55, life: 0, col: shade(p.d.color, 80) }
      : { x: p.x + dir * 14 + rnd(4, -4), y: p.y - 14, vy: 40, life: 0, col: p.d.color });
  }
}
// side-view drug table (far-left): drugs stand along the tabletop at y = `top`
function tableHomes(n, top = H * 0.60) { const x0 = W * 0.06, x1 = W * 0.46, pad = 40, usable = (x1 - x0) - pad * 2, step = n > 1 ? Math.min(58, usable / (n - 1)) : 0, first = (x0 + x1) / 2 - step * (n - 1) / 2;
  return Array.from({ length: n }, (_, i) => ({ x: first + i * step, y: top - 30 })); }
// big top warning + product-loss readout, shared by SELECT + DECANT
function bigWarn(text, tint, alpha) {
  G.save(); G.textAlign = 'center'; G.globalAlpha = clamp(alpha, 0, 1); G.font = 'bold 27px monospace'; const y = H * 0.13;
  G.fillStyle = 'rgba(255,74,91,.4)'; G.fillText(text, W / 2 - 2, y);
  G.fillStyle = 'rgba(95,208,224,.4)'; G.fillText(text, W / 2 + 2, y);
  G.shadowColor = `rgba(${tint},.9)`; G.shadowBlur = 20; G.fillStyle = `rgb(${tint})`; G.fillText(text, W / 2, y); G.shadowBlur = 0; G.restore();
}
function drawCarryWarn(s) {
  // No steadiness meter — you carry by feel. Only the consequence shows: a flash while
  // it's actually spilling, and the running product-loss tally.
  if (s._spillT > 0) bigWarn('⚠ SPILLING — LOSING PRODUCT ⚠', '255,74,91', .7 + .3 * Math.sin(s.t * 14));
  if (s.lost > 0) { G.save(); textShadowOn(); G.textAlign = 'center'; G.globalAlpha = .85; G.fillStyle = '#ff6a6a'; G.font = 'bold 14px monospace'; G.fillText(`PRODUCT LOST: ${Math.round(s.lost)}%`, W / 2, H * 0.13 + 26); G.restore(); }
}

// ── entry points ─────────────────────────────────────────────────────────────
export function openSpliceSelect(msg) {
  closeSplice();
  const lab = mountLab({ title: 'CHIMERA-9', subtitle: 'SPLICE · SELECT', accent: '#4fe08a', showInsta: true, test: !!msg.test });
  ensureLabelStyle();
  game = newSession(lab, msg.test ? 'test' : 'real');
  game.drugs = (msg.drugs || []).map(d => ({
    drug: d.drug, name: d.name, blocks: d.blocks || {},
    form: d.form || 'liquid', color: d.color || '#4fe08a', sub: d.sub || subFor(d.form || 'liquid'),
    vol: d.vol ?? .4, known: d.known ?? 1, count: d.count ?? 1,
  }));
  game.stabilizerCount = msg.stabilizerCount ?? (msg.hasStabilizer ? 99 : 0);
  game.allow3way = !!msg.allow3way;
  game.qtyBase = 1; game.qtySplice = 1; game.qtySplice2 = 1;
  game.compoundName = '';
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
  game.compoundName = (_stash && _stash.name) || '';
  game.difficulty = opts.difficulty || 8;
  game.onResolve = opts.onResult || null;
  game.automated = new Set(opts.automated || []);   // stage keys an automation rig handles
  game.autoScore = opts.autoScore || 70;            // Chemistry-scaled score for an automated stage
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
// Stage order through the reaction (rhythm is last → resolve).
const STAGE_NEXT = { charge: 'mix', mix: 'pour', pour: 'stir', stir: 'heat', heat: 'rhythm' };
const SCORED_STAGES = ['mix', 'pour', 'stir', 'heat', 'rhythm'];   // 'charge' (decant) carries no score

// If the player has an automation rig for this stage, the rig clears it: bank the
// Chemistry-scaled auto-score and advance after a beat, no hands-on play.
function maybeAutomate(g, name) {
  if (!g.automated || !g.automated.has(name)) return;
  if (SCORED_STAGES.includes(name)) g.scores[name] = (g.autoScore || 70) / 100;
  g.lab.ticker(`▸ ${name === 'charge' ? 'DECANT' : name.toUpperCase()} — automation rig handles it.`);
  setTimeout(() => {
    if (!g || g.closed) return;
    if (name === 'rhythm') { if (g.mode === 'test') finalizeTest(); else resolveReal(); }
    else transit(g, STAGE_NEXT[name]);
  }, 750);
}

function go(g, name) {
  if (stage && stage.exit) stage.exit();
  g.lab.ui.innerHTML = ''; hideLabel();
  stage = STAGES[name];
  if (stage.enter) stage.enter();
  maybeAutomate(g, name);
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
  .splice-label{position:absolute;z-index:9;width:200px;pointer-events:none;background:linear-gradient(180deg,color-mix(in srgb,var(--A,#4fe08a) 16%,var(--bg2,#0d0d16)),color-mix(in srgb,var(--A,#4fe08a) 6%,var(--bg2,#0d0d16)));border:1px solid color-mix(in srgb,var(--A,#4fe08a) 40%,transparent);border-radius:6px;padding:9px 10px;box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 45%,transparent),0 10px 30px rgba(0,0,0,.8);font-size:10px;font-family:'Courier New',var(--font-mono,monospace)}
  .splice-label .nm{font-size:13px;letter-spacing:2px;color:var(--A,#4fe08a);font-weight:bold;text-transform:uppercase}
  .splice-label .row{display:flex;justify-content:space-between;color:var(--fgdim,#6f8a7c);margin:2px 0;text-transform:uppercase;font-size:8px;letter-spacing:1px}
  .splice-label .row b{color:color-mix(in srgb,var(--A,#4fe08a) 55%,#fff)}
  .splice-label .blk{border-top:1px dashed color-mix(in srgb,var(--A,#4fe08a) 25%,transparent);padding-top:5px;margin-top:5px;color:color-mix(in srgb,var(--A,#4fe08a) 55%,#fff);line-height:1.4}
  .splice-label .redact{color:#3a4a42;background:#111}
  .splice-label .known{position:absolute;top:8px;right:10px;font-size:7px;color:var(--fgdim,#6f8a7c);letter-spacing:1px}`;
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
  const fill = clamp(phys.fill ?? 1, 0, 1);
  // light from upper-left: a curved wall tint + two specular streaks give the glass volume
  const glassLit = (w, h, r) => { const g = G.createLinearGradient(-w / 2, 0, w / 2, 0); g.addColorStop(0, 'rgba(150,180,190,.20)'); g.addColorStop(.42, 'rgba(205,228,236,.05)'); g.addColorStop(1, 'rgba(70,100,110,.24)'); G.fillStyle = g; roundRect(-w / 2, -h / 2, w, h, r); G.fill(); };
  const glassSheen = (w, h) => { const sp = G.createLinearGradient(-w / 2 + 3, 0, -w / 2 + 9, 0); sp.addColorStop(0, 'rgba(255,255,255,.55)'); sp.addColorStop(1, 'rgba(255,255,255,0)'); G.fillStyle = sp; roundRect(-w / 2 + 3, -h / 2 + 7, 5, h - 16, 2); G.fill(); G.fillStyle = 'rgba(255,255,255,.12)'; roundRect(w / 2 - 5, -h / 2 + 12, 2, h - 26, 1); G.fill(); };
  G.save(); G.translate(x, y); G.rotate(tilt);
  if (hi || inCradle || warn > 0.05) { G.shadowColor = warn > 0.1 ? `rgba(255,90,90,${clamp(warn, 0, 1)})` : c; G.shadowBlur = held ? 26 : (inCradle ? 18 : 12); }
  if (d.form === 'liquid') {
    const gw = 26, gh = 62;
    glassLit(gw, gh, 8);
    G.save(); roundRect(-gw / 2 + 2, -gh / 2 + 3, gw - 4, gh - 6, 6); G.clip();
    // surface drops as the vial empties; `lean` piles the liquid to the side OPPOSITE the
    // carry (inertia lag), on top of the gravity-leveling slope and a live ripple.
    const fillTop = 6 + (1 - fill) * (gh - 18), s = -tilt + slosh * 0.42, wob = slosh * 2.4;
    const surfY = px => fillTop + s * px + Math.sin(px * 0.35 + t * 7) * wob;
    G.beginPath(); G.moveTo(-gw / 2, gh / 2);
    for (let px = -gw / 2; px <= gw / 2; px += 3) G.lineTo(px, surfY(px));
    G.lineTo(gw / 2, gh / 2); G.closePath();
    const lg = G.createLinearGradient(-gw / 2, fillTop - 8, gw / 2, gh / 2); lg.addColorStop(0, shade(c, 60)); lg.addColorStop(.28, shade(c, 14)); lg.addColorStop(1, shade(c, -52));
    G.fillStyle = lg; G.fill();
    G.strokeStyle = shade(c, 88); G.lineWidth = 1.4; G.globalAlpha = .85; G.beginPath();
    for (let px = -gw / 2; px <= gw / 2; px += 3) { const yy = surfY(px); px === -gw / 2 ? G.moveTo(px, yy) : G.lineTo(px, yy); } G.stroke(); G.globalAlpha = 1;
    for (let i = 0; i < 3; i++) { G.fillStyle = 'rgba(255,255,255,.22)'; G.beginPath(); G.arc(Math.sin(t * 2 + i + slosh) * 5, fillTop + 14 + Math.cos(t * 1.7 + i) * 7, 1.5, 0, 7); G.fill(); }
    G.restore();
    G.strokeStyle = 'rgba(225,245,250,.6)'; G.lineWidth = 1.6; roundRect(-gw / 2, -gh / 2, gw, gh, 8); G.stroke();
    glassSheen(gw, gh);
    G.fillStyle = '#2a343a'; roundRect(-8, -gh / 2 - 8, 16, 10, 2); G.fill(); G.fillStyle = 'rgba(255,255,255,.14)'; G.fillRect(-7, -gh / 2 - 7, 14, 2); G.fillStyle = '#1a2024'; G.fillRect(-6, -gh / 2 - 1, 12, 3);
  } else if (d.form === 'powder') {
    const bw = 42, bh = 58;
    glassLit(bw, bh, 4);
    G.save(); roundRect(-bw / 2 + 3, -bh / 2 + 10, bw - 6, bh - 16, 3); G.clip();
    const shift = slosh * 6, heapH = (bh - 26) * fill, heapTop = bh / 2 - 4 - heapH;
    const pg = G.createLinearGradient(0, heapTop - 4, 0, bh / 2); pg.addColorStop(0, shade(c, 18)); pg.addColorStop(1, shade(c, -24));
    G.fillStyle = pg; G.beginPath(); G.moveTo(-bw / 2, bh / 2);
    for (let px = -bw / 2; px <= bw / 2; px += 4) G.lineTo(px, heapTop - Math.cos(px * 0.11) * 4 - px * 0.02 * shift);
    G.lineTo(bw / 2, bh / 2); G.closePath(); G.fill();
    for (let i = 0; i < 26; i++) { G.fillStyle = i % 3 ? shade(c, 26) : shade(c, -30); G.fillRect(-bw / 2 + 2 + Math.random() * (bw - 4), bh / 2 - 2 - Math.random() * Math.max(4, heapH - 2), 1.4, 1.4); }
    if (d.sub === 'crystalline') { G.fillStyle = 'rgba(255,255,255,.5)'; for (let i = 0; i < 6; i++) { G.save(); G.translate(-12 + Math.random() * 24, bh / 2 - 4 - Math.random() * Math.max(6, heapH - 4)); G.rotate(Math.random() * 3); G.fillRect(-1, -3, 2, 6); G.restore(); } }
    G.restore();
    G.strokeStyle = 'rgba(210,230,240,.42)'; G.lineWidth = 1.2; roundRect(-bw / 2, -bh / 2, bw, bh, 4); G.stroke();
    const cap = G.createLinearGradient(0, -bh / 2, 0, -bh / 2 + 7); cap.addColorStop(0, 'rgba(240,248,250,.8)'); cap.addColorStop(1, 'rgba(190,205,212,.55)');
    G.fillStyle = cap; G.fillRect(-bw / 2, -bh / 2, bw, 7);
    G.strokeStyle = 'rgba(120,140,150,.5)'; G.lineWidth = 1; for (let i = -bw / 2 + 2; i < bw / 2; i += 3) { G.beginPath(); G.moveTo(i, -bh / 2); G.lineTo(i, -bh / 2 + 6); G.stroke(); }
    glassSheen(bw, bh);
  } else if (d.form === 'gel') {
    const amp = (1 + Math.abs(slosh) * 0.5) * (0.62 + 0.38 * fill);   // blob shrinks as it drains
    const gg = G.createRadialGradient(-5, -6, 3, 0, 5, 28 * amp); gg.addColorStop(0, shade(c, 84)); gg.addColorStop(.5, c); gg.addColorStop(1, shade(c, -30));
    G.fillStyle = gg; blob(0, 0, 24 * amp, 20 / amp, t * 1.6 + slosh * 3); G.fill();
    G.strokeStyle = 'rgba(255,255,255,.5)'; G.lineWidth = 1.4; blob(0, 0, 24 * amp, 20 / amp, t * 1.6 + slosh * 3); G.stroke();
    G.globalAlpha = .5; G.strokeStyle = shade(c, -40); G.lineWidth = 2.4; blob(1, 2, 22 * amp, 18 / amp, t * 1.6 + slosh * 3); G.stroke(); G.globalAlpha = 1;   // lower-right core shadow = volume
    G.fillStyle = 'rgba(255,255,255,.45)'; G.beginPath(); G.arc(Math.sin(t * 1.3) * 5 + slosh * 6 - 4, Math.cos(t * 1.1) * 4 - 5, 4, 0, 7); G.fill();
    G.globalAlpha = .5; G.fillStyle = shade(c, 95); G.beginPath(); G.arc(slosh * 4, 2, 8, 0, 7); G.fill(); G.globalAlpha = 1;
  } else if (d.form === 'gas') {
    const cw = 26, ch = 60;
    const bg = G.createLinearGradient(-cw / 2, 0, cw / 2, 0); bg.addColorStop(0, '#2a333b'); bg.addColorStop(.32, '#9aa7b2'); bg.addColorStop(.5, '#c4d0d8'); bg.addColorStop(.7, '#7a8792'); bg.addColorStop(1, '#232a30');
    G.fillStyle = bg; roundRect(-cw / 2, -ch / 2 + 6, cw, ch - 6, 6); G.fill();
    const band = 22 * fill; G.globalAlpha = .82; G.fillStyle = c; G.fillRect(-cw / 2 + 2, ch / 2 - 2 - band, cw - 4, band); G.globalAlpha = 1;
    G.strokeStyle = shade(c, 60); G.lineWidth = 1; G.strokeRect(-cw / 2 + 2, ch / 2 - 2 - band, cw - 4, band);
    G.strokeStyle = 'rgba(220,235,240,.5)'; G.lineWidth = 1.4; roundRect(-cw / 2, -ch / 2 + 6, cw, ch - 6, 6); G.stroke();
    G.fillStyle = 'rgba(255,255,255,.35)'; G.fillRect(-cw / 2 + 4, -ch / 2 + 10, 3, ch - 22);
    G.fillStyle = 'rgba(255,255,255,.12)'; G.fillRect(cw / 2 - 5, -ch / 2 + 14, 2, ch - 30);
    G.fillStyle = '#20262b'; G.fillRect(-4, -ch / 2 - 4, 8, 12); G.fillStyle = '#4a545c'; G.fillRect(-6, -ch / 2 - 6, 12, 4);
    G.save(); G.translate(0, -ch / 2 + 18);
    G.fillStyle = '#0c1114'; G.beginPath(); G.arc(0, 0, 7, 0, 7); G.fill(); G.strokeStyle = 'rgba(200,220,225,.5)'; G.lineWidth = 1; G.stroke();
    const na = -Math.PI * 0.75 + (0.5 + slosh * 0.4) * Math.PI * 1.5;
    G.strokeStyle = Math.abs(slosh) > 0.6 ? '#ff4a5b' : '#4fe08a'; G.lineWidth = 1.4; G.beginPath(); G.moveTo(0, 0); G.lineTo(Math.cos(na) * 5, Math.sin(na) * 5); G.stroke(); G.restore();
    if (Math.abs(slosh) > 0.5) { G.globalAlpha = Math.min(.4, Math.abs(slosh) * .3); G.fillStyle = shade(c, 80); for (let i = 0; i < 3; i++) { G.beginPath(); G.arc(rnd(6, -6), -ch / 2 - 8 - i * 4, 2 + i, 0, 7); G.fill(); } G.globalAlpha = 1; }
  } else if (d.form === 'crystal') {
    G.fillStyle = 'rgba(180,190,200,.3)'; G.beginPath(); G.ellipse(0, 14, 22, 7, 0, 0, 7); G.fill();
    G.strokeStyle = 'rgba(210,220,230,.4)'; G.lineWidth = 1; G.stroke();
    const cg = G.createLinearGradient(-13, -26, 13, 14); cg.addColorStop(0, shade(c, 94)); cg.addColorStop(.45, c); cg.addColorStop(1, shade(c, -38));
    G.fillStyle = cg; G.beginPath(); G.moveTo(0, -26); G.lineTo(-13, -2); G.lineTo(-7, 14); G.lineTo(7, 14); G.lineTo(13, -2); G.closePath(); G.fill();
    G.fillStyle = 'rgba(0,0,0,.22)'; G.beginPath(); G.moveTo(0, -26); G.lineTo(13, -2); G.lineTo(7, 14); G.lineTo(0, 8); G.closePath(); G.fill();   // shaded right facets = volume
    G.strokeStyle = 'rgba(255,255,255,.5)'; G.lineWidth = 1; G.beginPath(); G.moveTo(0, -26); G.lineTo(-7, 14); G.moveTo(0, -26); G.lineTo(7, 14); G.moveTo(-13, -2); G.lineTo(13, -2); G.stroke();
    G.shadowColor = c; G.shadowBlur = hi || inCradle ? 18 : 10; G.strokeStyle = shade(c, 55); G.beginPath(); G.moveTo(0, -26); G.lineTo(-13, -2); G.lineTo(-7, 14); G.lineTo(7, 14); G.lineTo(13, -2); G.closePath(); G.stroke(); G.shadowBlur = 0;
    G.fillStyle = 'rgba(255,255,255,.85)'; G.beginPath(); G.arc(-4, -10, 1.6, 0, 7); G.fill();
    G.fillStyle = 'rgba(255,255,255,.5)'; G.beginPath(); G.arc(3, 1, 1, 0, 7); G.fill();
  } else if (d.form === 'blotter') {
    const bw = 44, bh = 44, cell = bw / 4;
    const pg = G.createLinearGradient(-bw / 2, -bh / 2, bw / 2, bh / 2); pg.addColorStop(0, 'rgba(244,240,228,.95)'); pg.addColorStop(1, 'rgba(206,200,182,.9)');
    G.fillStyle = pg; roundRect(-bw / 2, -bh / 2, bw, bh, 2); G.fill();
    for (let r = 0; r < 4; r++) for (let cc = 0; cc < 4; cc++) { const px = -bw / 2 + cc * cell, py = -bh / 2 + r * cell;
      G.globalAlpha = .85; G.fillStyle = ((r + cc) % 2) ? shade(c, 12) : shade(c, -16); G.fillRect(px + 1, py + 1, cell - 2, cell - 2); G.globalAlpha = 1;
      G.fillStyle = shade(c, 64); G.beginPath(); G.arc(px + cell / 2, py + cell / 2, 1.4, 0, 7); G.fill(); }
    G.strokeStyle = 'rgba(120,110,90,.4)'; G.lineWidth = .5; G.setLineDash([1, 2]);
    for (let i = 1; i < 4; i++) { G.beginPath(); G.moveTo(-bw / 2 + i * cell, -bh / 2); G.lineTo(-bw / 2 + i * cell, bh / 2); G.moveTo(-bw / 2, -bh / 2 + i * cell); G.lineTo(bw / 2, -bh / 2 + i * cell); G.stroke(); }
    G.setLineDash([]); G.strokeStyle = 'rgba(120,110,90,.5)'; G.lineWidth = 1; roundRect(-bw / 2, -bh / 2, bw, bh, 2); G.stroke();
    G.fillStyle = 'rgba(255,255,255,.3)'; G.beginPath(); G.moveTo(-bw / 2, -bh / 2); G.lineTo(-bw / 2 + 14, -bh / 2); G.lineTo(-bw / 2, -bh / 2 + 14); G.closePath(); G.fill();
  } else if (d.form === 'paste') {
    const amp = 0.66 + 0.34 * fill;
    G.fillStyle = 'rgba(200,195,180,.25)'; roundRect(-24, -18, 48, 36, 4); G.fill();
    const tg = G.createRadialGradient(-6, -6, 3, 0, 3, 26); tg.addColorStop(0, shade(c, 40)); tg.addColorStop(.6, shade(c, -42)); tg.addColorStop(1, shade(c, -72));
    G.fillStyle = tg; blob(0, 0, 22 * amp, 15 * amp, t * 0.6 + slosh * 1.5); G.fill();
    G.fillStyle = 'rgba(255,255,255,.32)'; G.beginPath(); G.ellipse(-5, -5, 7, 3, -0.4, 0, 7); G.fill();
    G.fillStyle = 'rgba(255,255,255,.15)'; G.beginPath(); G.ellipse(6, 3, 4, 2, 0.3, 0, 7); G.fill();
    G.strokeStyle = 'rgba(200,195,180,.4)'; G.lineWidth = 1; roundRect(-24, -18, 48, 36, 4); G.stroke();
    G.fillStyle = 'rgba(255,255,255,.14)'; G.fillRect(-22, -16, 3, 30);
  } else if (d.form === 'leaf') {
    const bw = 42, bh = 56;
    glassLit(bw, bh, 4);
    G.save(); roundRect(-bw / 2 + 3, -bh / 2 + 10, bw - 6, bh - 16, 3); G.clip();
    const shift = slosh * 5, spread = Math.max(6, (bh - 22) * fill);
    // the pile is settled, not swarming — fix each fleck's spot once (cached on the
    // drug) so it lies still at rest, and only slides sideways when the jar is carried.
    const bits = d._leafBits || (d._leafBits = Array.from({ length: 22 }, () => ({ fx: Math.random(), fy: Math.random(), rot: Math.random() * 3 })));
    for (let i = 0; i < bits.length; i++) { const bit = bits[i]; G.save(); G.translate(-bw / 2 + 5 + bit.fx * (bw - 10) - shift * 0.3, bh / 2 - 5 - bit.fy * spread); G.rotate(bit.rot);
      G.fillStyle = i % 3 ? shade(c, 12) : shade(c, -24); G.beginPath(); G.moveTo(0, -2.5); G.lineTo(2, 0); G.lineTo(0, 2.5); G.lineTo(-2, 0); G.closePath(); G.fill(); G.restore(); }
    for (let k = 0; k < 2; k++) { G.save(); G.translate(-7 + k * 14, bh / 2 - 5 - Math.min(14, spread * 0.5)); G.rotate(0.4 - k * 0.8);
      G.fillStyle = shade(c, k ? 26 : -8); G.beginPath(); G.ellipse(0, 0, 3, 8, 0, 0, 7); G.fill();
      G.strokeStyle = shade(c, -30); G.lineWidth = 0.6; G.beginPath(); G.moveTo(0, -7); G.lineTo(0, 7); G.stroke(); G.restore(); }
    G.restore();
    G.strokeStyle = 'rgba(210,230,240,.42)'; G.lineWidth = 1.2; roundRect(-bw / 2, -bh / 2, bw, bh, 4); G.stroke();
    const capL = G.createLinearGradient(0, -bh / 2, 0, -bh / 2 + 7); capL.addColorStop(0, 'rgba(240,248,250,.8)'); capL.addColorStop(1, 'rgba(190,205,212,.55)');
    G.fillStyle = capL; G.fillRect(-bw / 2, -bh / 2, bw, 7);
    G.strokeStyle = 'rgba(120,140,150,.5)'; G.lineWidth = 1; for (let i = -bw / 2 + 2; i < bw / 2; i += 3) { G.beginPath(); G.moveTo(i, -bh / 2); G.lineTo(i, -bh / 2 + 6); G.stroke(); }
    glassSheen(bw, bh);
  } else {
    const bw = 46, bh = 40;
    const pk = G.createLinearGradient(-bw / 2, -bh / 2, bw / 2, bh / 2); pk.addColorStop(0, 'rgba(198,208,218,.4)'); pk.addColorStop(1, 'rgba(150,160,172,.3)');
    G.fillStyle = pk; roundRect(-bw / 2, -bh / 2, bw, bh, 4); G.fill();
    for (let r = 0; r < 2; r++) for (let cc = 0; cc < 3; cc++) { const px = -14 + cc * 14, py = -8 + r * 16 + slosh * 1.4 * (r ? 1 : -1);
      G.fillStyle = 'rgba(20,26,30,.4)'; G.beginPath(); G.arc(px + 1, py + 1.5, 6, 0, 7); G.fill();
      G.fillStyle = 'rgba(235,240,245,.55)'; G.beginPath(); G.arc(px, py, 6, 0, 7); G.fill();
      const pil = G.createRadialGradient(px - 2, py - 2, 1, px, py, 5); pil.addColorStop(0, shade(c, 55)); pil.addColorStop(1, shade(c, -18));
      G.fillStyle = pil; G.beginPath(); G.arc(px, py, 4.4, 0, 7); G.fill();
      G.fillStyle = 'rgba(255,255,255,.7)'; G.beginPath(); G.arc(px - 1.6, py - 1.6, 1.4, 0, 7); G.fill(); }
    G.strokeStyle = 'rgba(210,220,230,.45)'; G.lineWidth = 1; roundRect(-bw / 2, -bh / 2, bw, bh, 4); G.stroke();
    G.fillStyle = 'rgba(255,255,255,.14)'; roundRect(-bw / 2 + 3, -bh / 2 + 3, bw - 6, 5, 2); G.fill();
  }
  G.shadowBlur = 0; G.restore();
  if (phys.noName) return; // scattered title-screen packages carry no label
  G.save(); textShadowOn(); G.textAlign = 'center';
  G.fillStyle = inCradle ? '#4fe08a' : (hi ? brightCol() : dimCol()); G.font = 'bold 11px monospace';
  G.fillText((d.known ?? 1) > .4 ? d.name : '???', x, y + 46);
  if (inCradle) { const idx = game.selected.indexOf(d); G.fillStyle = '#4fe08a'; G.font = 'bold 10px monospace'; G.fillText(idx === 0 ? '◆ BASE' : '+ GRAFT', x, y + 58); }
  G.restore();
}

// ══ STAGES ═══════════════════════════════════════════════════════════════════
const STAGES = {};

// TITLE — the bench powers up with the player's drugs scattered across it, then
// BEGIN drops into the selection screen. Pure client-side intro (no server hit).
STAGES.title = {
  enter() {
    const g = game; this.t = 0; this.pw = 0; this.spin = 0; this.titleA = 0; this.flick = 1; this.btnShown = false; this.ready = false; this._begun = false;
    this.quip = ['this bench has killed better chemists than you.', 'ventilation nominal. conscience optional.', 'everything on this table is technically evidence.', 'mind the third beaker. it bites.', "wash your hands. it won't help.", 'the last operator is still in here somewhere.', "don't taste to check. we mean it this time.", 'the fumes only sound like voices at first.'][Math.floor(rnd(8))];
    const homes = tableHomes(g.drugs.length);
    this.scatter = g.drugs.map((d, i) => ({ d, x: homes[i].x, y: homes[i].y, bob: rnd(7) }));
    g.lab.setTop('CHIMERA-9 · GENESPLICER'); g.lab.ticker('');
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
    // ── unkempt: a dried smear that might be blood, hairline scratches, and a
    //    sickly red pulse so the reward reads "wrong" without ever shouting ──
    G.save(); G.globalAlpha = this.titleA;
    const smx = cx - 214, smy = benchY - 30;
    G.fillStyle = 'rgba(84,10,12,.5)';
    G.beginPath(); G.moveTo(smx, smy); G.bezierCurveTo(smx + 20, smy - 7, smx + 44, smy + 4, smx + 60, smy - 2);
    G.bezierCurveTo(smx + 70, smy + 9, smx + 42, smy + 16, smx + 22, smy + 11); G.bezierCurveTo(smx + 6, smy + 9, smx - 3, smy + 6, smx, smy); G.closePath(); G.fill();
    G.strokeStyle = 'rgba(92,12,14,.4)'; G.lineWidth = 5; G.lineCap = 'round'; G.beginPath(); G.moveTo(smx + 58, smy - 2); G.lineTo(smx + 104, smy + 7); G.stroke();
    G.fillStyle = 'rgba(70,8,10,.55)'; for (const d of [[14, 11], [36, 17], [54, 9]]) { G.beginPath(); G.ellipse(smx + d[0], smy + d[1], 2, 5.5, 0, 0, 7); G.fill(); }
    G.strokeStyle = 'rgba(200,230,235,.10)'; G.lineWidth = 1; G.beginPath(); G.moveTo(cx - 120, 40); G.lineTo(cx - 60, 70); G.moveTo(cx + 92, 34); G.lineTo(cx + 42, 74); G.stroke();
    G.restore();
    const sick = clamp(0.05 + 0.045 * Math.sin(this.t * 1.3), 0, 0.12) * this.titleA;
    const vg = G.createRadialGradient(cx, H * 0.42, H * 0.3, cx, H * 0.42, H * 0.78);
    vg.addColorStop(0, 'rgba(120,0,10,0)'); vg.addColorStop(1, `rgba(120,0,12,${sick})`);
    G.fillStyle = vg; G.fillRect(0, 0, W, H);

    G.save(); G.globalAlpha = this.titleA; G.textAlign = 'center';
    const ty = H * 0.30, rw = 210 * pw;
    // clearance rules framing the logo — reward-screen chrome
    G.strokeStyle = `rgba(79,224,138,${.32 * this.titleA})`; G.lineWidth = 1;
    G.beginPath(); G.moveTo(cx - rw, ty - 30); G.lineTo(cx + rw, ty - 30); G.moveTo(cx - rw, ty + 46); G.lineTo(cx + rw, ty + 46); G.stroke();
    // CHIMERA-9 hero — chromatic split + green bloom (the reward for climbing the ladder)
    G.font = "900 52px 'DejaVu Sans Mono','Consolas',monospace";
    G.fillStyle = 'rgba(255,74,91,.42)'; G.fillText('CHIMERA-9', cx - 2.5, ty);
    G.fillStyle = 'rgba(95,208,224,.42)'; G.fillText('CHIMERA-9', cx + 2.5, ty);
    G.shadowColor = 'rgba(79,224,138,.9)'; G.shadowBlur = 30 * pw * fl; G.fillStyle = '#eafff2'; G.fillText('CHIMERA-9', cx, ty); G.shadowBlur = 0;
    G.font = "12px 'DejaVu Sans Mono',monospace"; G.fillStyle = 'rgba(159,199,172,.9)'; G.fillText('G E N E S P L I C E R', cx, ty + 26);
    if (this.titleA > 0.5) { drawLCD(cx - 148, ty + 56, 96, 22, 'ONLINE', '#4fe08a', 'CHIMERA-9'); drawLCD(cx + 52, ty + 56, 96, 22, `${game.drugs.length} RGT`, '#5fd0e0', 'REAGENTS'); }
    G.globalAlpha = this.titleA * .7 * (0.6 + 0.4 * Math.sin(this.t * 2)); textShadowOn(); G.fillStyle = dimCol(); G.font = 'bold italic 13px monospace';
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
    // lift the whole playfield (drug table + cradle) up off the bottom UI panels
    const g = game; const base = this.base = H * 0.44; const homes = tableHomes(g.drugs.length, base);
    this.pkgs = g.drugs.map((d, i) => { const hx = homes[i].x, hy = homes[i].y, w = 2 * Math.PI * (FORM_FREQ[d.form] || 2.2), k = w * w, c = 2 * 0.62 * w;
      return { d, home: { x: hx, y: hy }, x: hx, y: hy, vx: 0, vy: 0, pvx: 0, tilt: 0, slosh: 0, sloshV: 0, held: false, inCradle: false, gdx: 0, gdy: 0, k, c, fluid: FORM_FLUID[d.sub] ?? .3, remaining: 1, warn: 0 }; });
    this.cradle = { x: W * 0.73, y: base, r: 58 };
    this.drag = null; this.pressP = null; this.pressT = 0; this.moved = false; this.hover = null; this.t = 0; this.drips = [];
    this._spillT = 0; this._alarmT = 0; this.lost = 0;
    this.mkBtns(); g.selected = []; this.sync();
    g.lab.ticker('');
    AX.loop('hood', { freq: 60, type: 'sawtooth', gain: .03, filt: 340, tremRate: 7, tremDepth: .3 });
  },
  exit() { AX.stop('hood'); game.lab.canvas.style.cursor = 'default'; },
  mkBtns() {
    // Two clearly separated groups: a bordered "workspace" console holding the slot
    // panels (drawn first so it sits behind them), then a divider, then the action
    // row (name + CLEAR/SPLICE) well below it so the two never crowd each other.
    const three = !!game.allow3way;
    const wd = three ? 224 : 268;
    const xs = three ? [12, 246, 480, 714] : [20, 300, 580];
    const frameL = xs[0] - 10, frameR = xs[three ? 3 : 2] + wd + 10;
    this.workFrame = mkEl(`position:absolute;left:${frameL}px;right:${W - frameR}px;bottom:112px;top:150px;border:1px solid color-mix(in srgb,var(--A) 22%,transparent);border-radius:10px;background:color-mix(in srgb,var(--A) 4%,transparent);pointer-events:none`);
    mkEl(`position:absolute;left:${frameL + 12}px;top:138px;font-size:9px;font-weight:bold;letter-spacing:2px;color:var(--fgdim);pointer-events:none;text-shadow:0 0 6px color-mix(in srgb,var(--bg,#05050a) 85%,transparent)`).textContent = '◈ REACTION WORKSPACE';
    mkEl(`position:absolute;left:${frameL}px;right:${W - frameR}px;bottom:100px;height:1px;background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--A) 35%,transparent) 20%,color-mix(in srgb,var(--A) 35%,transparent) 80%,transparent);pointer-events:none`);

    this.splice = mkBtn('SPLICE ▶', 'right:22px;bottom:54px'); this.splice.disabled = true;
    this.splice.onclick = () => { if (this.canCommit()) { AX.confirm(); this.commit(); } else if (!game.compoundName) { this.nameEl.focus(); this.nameEl.classList.add('lab-shake'); setTimeout(() => this.nameEl.classList.remove('lab-shake'), 400); } };
    this.clr = mkBtn('CLEAR', 'right:160px;bottom:54px', 'ghost');
    this.clr.onclick = () => { AX.click(); this.pkgs.forEach(p => p.inCradle = false); game.selected = []; this.sync(); };
    // Saved-recipe shortcut (client-only, top-left). A compact chip toggles the
    // list of compounds you've committed before; picking one pre-fills the slots.
    this.rcpBtn = mkEl('position:absolute;left:14px;top:42px;z-index:12;pointer-events:auto;cursor:pointer;font-size:10px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:var(--A);background:var(--surf-lo);border:1px solid color-mix(in srgb,var(--A) 40%,transparent);border-radius:6px;padding:6px 10px');
    this.rcpBtn.onclick = () => { AX.click(); this.toggleRecipes(); };
    this.rcpPanel = mkEl('position:absolute;left:14px;top:70px;width:258px;max-height:262px;overflow-y:auto;display:none;z-index:12;pointer-events:auto;background:linear-gradient(180deg,var(--surf-hi),var(--surf-lo));border:1px solid color-mix(in srgb,var(--A) 34%,transparent);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.6);padding:7px');
    this.rcpOpen = false;
    this.refreshRecipeBtn();
    // Required naming — you label the compound before you can splice it.
    this.nameEl = document.createElement('input'); this.nameEl.className = 'lab-field'; this.nameEl.maxLength = 28;
    this.nameEl.placeholder = 'NAME YOUR COMPOUND…'; this.nameEl.value = game.compoundName || '';
    this.nameEl.setAttribute('style', 'position:absolute;left:22px;bottom:54px;width:300px;pointer-events:auto');
    this.nameEl.oninput = () => { game.compoundName = this.nameEl.value.replace(/\s+/g, ' ').trimStart().slice(0, 28); this.sync(); };
    this.nameEl.onkeydown = (e) => { if (e.key !== 'Escape') e.stopPropagation(); if (e.key === 'Enter' && this.canCommit()) { AX.confirm(); this.commit(); } };
    game.lab.ui.appendChild(this.nameEl);
    this.hint = mkEl('position:absolute;left:50%;top:40px;transform:translateX(-50%);color:var(--fgdim);font-size:13px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;pointer-events:none;text-align:center;width:70%;text-shadow:0 0 6px color-mix(in srgb,var(--bg,#05050a) 85%,transparent)');
    // Persistent picker panels: BASE + SPLICE (+ SPLICE 2 when unlocked, high-Chemistry
    // only — see allow3way), each with a colour-swatch "raw graphic", effect readout,
    // and a quantity stepper, plus a projected OUTPUT. Layout tightens to four columns
    // when the 3rd slot is unlocked.
    this.pBase = this.mkSlotPanel('BASE', 0, 'qtyBase', xs[0], wd);
    this.pSplice = this.mkSlotPanel('SPLICE', 1, 'qtySplice', xs[1], wd);
    if (three) this.pSplice2 = this.mkSlotPanel('SPLICE 2', 2, 'qtySplice2', xs[2], wd);
    this.pOut = this.mkOutPanel(xs[three ? 3 : 2], wd);
    this.risk = this.pOut.risk;   // the live splice_preview readout feeds the OUTPUT panel
  },
  mkSlotPanel(role, idx, qtyKey, leftPx, wd) {
    const STEP = 'width:22px;height:22px;border-radius:4px;background:var(--surf-lo);border:1px solid color-mix(in srgb,var(--A) 42%,transparent);color:var(--A);font-size:15px;line-height:1;cursor:pointer;padding:0';
    const el = mkEl(`position:absolute;left:${leftPx}px;bottom:118px;width:${wd}px;background:linear-gradient(180deg,var(--surf-hi),var(--surf-lo));border:1px solid color-mix(in srgb,var(--A) 32%,transparent);border-radius:8px;box-shadow:inset 0 1px 0 var(--bevhi),0 6px 18px rgba(0,0,0,.5);padding:9px 11px;font-family:inherit;pointer-events:auto;box-sizing:border-box`);
    el.innerHTML =
      `<div style="display:flex;align-items:center;justify-content:space-between">` +
        `<span style="font-size:11px;letter-spacing:2px;color:var(--fgdim);font-weight:bold">${role}</span>` +
        `<button class="cx" title="clear" style="background:none;border:none;color:var(--fgdim);font-size:14px;font-weight:bold;cursor:pointer;padding:0">✕</button></div>` +
      `<div style="display:flex;align-items:center;gap:8px;margin-top:5px">` +
        `<div class="sw" style="width:30px;height:30px;border-radius:6px;background:var(--bg,#1a2a22);border:1px solid #0007;flex:none;box-shadow:inset 0 0 6px #0008"></div>` +
        `<div class="nm" style="font-size:14px;font-weight:bold;color:var(--fgdim);line-height:1.25;flex:1;min-width:0">— empty —</div></div>` +
      `<div class="fm" style="font-size:10px;font-weight:bold;color:var(--fgdim);margin-top:5px;text-transform:uppercase;letter-spacing:1px;min-height:12px"></div>` +
      `<div class="ef" style="font-size:11px;font-weight:bold;color:var(--fgdim);margin-top:4px;line-height:1.45;white-space:pre-line;min-height:28px">drop a drug into the cradle</div>` +
      `<div class="qr" style="display:flex;align-items:center;gap:7px;margin-top:6px;opacity:.55">` +
        `<span style="font-size:10px;font-weight:bold;color:var(--fgdim);letter-spacing:1px">QTY</span>` +
        `<button class="qm" style="${STEP}">−</button>` +
        `<span class="qn" style="font-size:16px;color:var(--A);min-width:26px;text-align:center;font-weight:bold">×1</span>` +
        `<button class="qp" style="${STEP}">+</button>` +
        `<span class="av" style="font-size:10px;font-weight:bold;color:var(--fgdim);margin-left:auto"></span></div>`;
    const p = { el, sw: el.querySelector('.sw'), nm: el.querySelector('.nm'), fm: el.querySelector('.fm'), ef: el.querySelector('.ef'), qn: el.querySelector('.qn'), qr: el.querySelector('.qr'), av: el.querySelector('.av') };
    el.querySelector('.cx').onclick = () => { const d = game.selected[idx]; if (!d) return; const pk = this.pkgs.find(x => x.d === d); if (pk) pk.inCradle = false; game.selected = game.selected.filter(x => x !== d); AX.click(); this.sync(); };
    el.querySelector('.qm').onclick = () => { game[qtyKey]--; AX.tick(); this.sync(); };
    el.querySelector('.qp').onclick = () => { game[qtyKey]++; AX.tick(); this.sync(); };
    return p;
  },
  mkOutPanel(leftPx, wd) {
    const el = mkEl(`position:absolute;left:${leftPx}px;bottom:118px;width:${wd}px;background:linear-gradient(180deg,var(--surf-hi),var(--surf-lo));border:1px solid color-mix(in srgb,var(--A) 34%,transparent);border-radius:8px;box-shadow:inset 0 1px 0 var(--bevhi),0 6px 18px rgba(0,0,0,.5);padding:9px 11px;font-family:inherit;pointer-events:none;box-sizing:border-box`);
    el.innerHTML =
      `<div style="font-size:11px;letter-spacing:2px;color:var(--fgdim);font-weight:bold">OUTPUT</div>` +
      `<div style="display:flex;align-items:center;gap:8px;margin-top:5px">` +
        `<div class="sw" style="width:30px;height:30px;border-radius:6px;background:var(--bg,#1a2a22);border:1px solid #0007;flex:none;box-shadow:inset 0 0 6px #0008"></div>` +
        `<div class="nm" style="font-size:14px;font-weight:bold;color:var(--fgdim);line-height:1.25">— nothing yet —</div></div>` +
      `<div class="ds" style="font-size:11px;font-weight:bold;color:var(--A);margin-top:5px;letter-spacing:1px;min-height:13px"></div>` +
      `<div class="risk" style="font-size:10px;font-weight:bold;color:var(--orange,#e0b878);margin-top:5px;line-height:1.5;white-space:pre-line;min-height:34px"></div>`;
    return { el, sw: el.querySelector('.sw'), nm: el.querySelector('.nm'), ds: el.querySelector('.ds'), risk: el.querySelector('.risk') };
  },
  refreshPanels() {
    const g = game;
    const fill = (p, drug, qty) => {
      if (!p) return;
      if (!drug) { p.sw.style.background = 'var(--bg,#1a2a22)'; p.sw.style.boxShadow = 'inset 0 0 6px #0008'; p.nm.textContent = '— empty —'; p.nm.style.color = 'var(--fgdim)'; p.fm.textContent = ''; p.ef.textContent = 'drop a drug into the cradle'; p.qn.textContent = '×1'; p.av.textContent = ''; p.qr.style.opacity = '.4'; return; }
      p.sw.style.background = drug.color; p.sw.style.boxShadow = `inset 0 0 6px #0008, 0 0 10px ${drug.color}66`;
      p.nm.textContent = drug.name; p.nm.style.color = 'var(--fgbright)';
      p.fm.textContent = `${drug.form} · ${drug.sub}`;
      p.ef.textContent = effText(drug);
      p.qn.textContent = '×' + qty; p.av.textContent = `have ${drug.count || 1}`; p.qr.style.opacity = '1';
    };
    fill(this.pBase, g.selected[0], g.qtyBase);
    fill(this.pSplice, g.selected[1], g.qtySplice);
    fill(this.pSplice2, g.selected[2], g.qtySplice2);
    const o = this.pOut, sel = g.selected.filter(Boolean), qtys = [g.qtyBase, g.qtySplice, g.qtySplice2];
    if (sel.length >= 2) {
      const out = Math.max(...sel.map((_, i) => qtys[i])), col = avgColor(sel);
      let fi = 0; for (let i = 1; i < sel.length; i++) if (qtys[i] > qtys[fi]) fi = i;
      o.sw.style.background = col; o.sw.style.boxShadow = `inset 0 0 6px #0008, 0 0 12px ${col}77`;
      o.nm.textContent = sel.length >= 3 ? 'triple-spliced compound' : 'spliced compound'; o.nm.style.color = 'var(--fgbright)';
      o.ds.textContent = `${out} dose${out === 1 ? '' : 's'} · ${sel[fi].form}`;
    } else {
      o.sw.style.background = 'var(--bg,#1a2a22)'; o.sw.style.boxShadow = 'inset 0 0 6px #0008';
      o.nm.textContent = '— nothing yet —'; o.nm.style.color = 'var(--fgdim)'; o.ds.textContent = '';
      if (o.risk) o.risk.textContent = '';
    }
  },
  // Clamp base/splice quantities to what's carried. The Stabilizer is a fixed
  // one-per-run overhead (not one per dose), so it no longer caps the batch —
  // only the source-drug supply does. Needing at least one stabilizer to splice
  // at all is gated separately (hasStabilizer).
  clampQtys() {
    const g = game;
    const lim = (i) => { const d = g.selected[i]; return d ? (d.count || 1) : 1; };
    g.qtyBase = clamp(g.qtyBase || 1, 1, lim(0));
    g.qtySplice = clamp(g.qtySplice || 1, 1, lim(1));
    g.qtySplice2 = clamp(g.qtySplice2 || 1, 1, lim(2));
  },
  slots() {
    const s = game.selected;
    const o = { base: { drug: s[0].drug, qty: game.qtyBase }, splice: { drug: s[1].drug, qty: game.qtySplice } };
    if (s[2]) o.splice2 = { drug: s[2].drug, qty: game.qtySplice2 };
    return o;
  },
  // ── saved recipes ──────────────────────────────────────────────────────────
  refreshRecipeBtn() { if (!this.rcpBtn) return; const n = loadRecipes().length; this.rcpBtn.textContent = `☰ RECIPES${n ? ` (${n})` : ''}`; },
  toggleRecipes() { this.rcpOpen = !this.rcpOpen; if (this.rcpOpen) this.renderRecipes(); this.rcpPanel.style.display = this.rcpOpen ? 'block' : 'none'; },
  closeRecipes() { this.rcpOpen = false; if (this.rcpPanel) this.rcpPanel.style.display = 'none'; },
  // Snapshot the current designer state as a recreatable recipe.
  recipeFromState() {
    const qtys = [game.qtyBase, game.qtySplice, game.qtySplice2];
    const drugs = game.selected.filter(Boolean).map((d, i) => ({ drug: d.drug, qty: qtys[i], label: d.name }));
    return { name: (game.compoundName || '').trim(), drugs, ts: Date.now() };
  },
  // Re-drop a saved recipe's drugs into the cradle. Drugs no longer in the kit are
  // skipped (and reported) — the shortcut can't conjure ingredients you don't have.
  loadRecipe(rec) {
    const qtyKeys = ['qtyBase', 'qtySplice', 'qtySplice2'];
    const max = game.allow3way ? 3 : 2;
    this.pkgs.forEach(p => p.inCradle = false); game.selected = [];
    const missing = [];
    (rec.drugs || []).slice(0, max).forEach(d => {
      const pk = this.pkgs.find(p => p.d.drug === d.drug && !p.inCradle);
      if (!pk) { missing.push(d.label || d.drug); return; }
      pk.inCradle = true; game.selected.push(pk.d);
      game[qtyKeys[game.selected.length - 1]] = Math.max(1, parseInt(d.qty, 10) || 1);
    });
    game.compoundName = (rec.name || '').slice(0, 28);
    if (this.nameEl) this.nameEl.value = game.compoundName;
    this.closeRecipes(); AX.drop(); this.sync();
    if (!game.selected.length) game.lab.ticker(`none of "${rec.name}"'s drugs are in your kit`, 'a');
    else if (missing.length) game.lab.ticker(`recreated "${rec.name}" — missing ${missing.join(', ')} (not in your kit)`, 'a');
  },
  renderRecipes() {
    const list = loadRecipes();
    if (!list.length) { this.rcpPanel.innerHTML = `<div style="font-size:11px;font-weight:bold;color:var(--fgdim);padding:10px;text-align:center;white-space:pre-line">no saved recipes yet —\ncommit a splice to save it</div>`; return; }
    this.rcpPanel.innerHTML = `<div style="font-size:9px;font-weight:bold;letter-spacing:2px;color:var(--fgdim);padding:2px 4px 6px">SAVED COMPOUNDS</div>`;
    list.forEach(rec => {
      const row = document.createElement('div');
      row.setAttribute('style', 'display:flex;align-items:center;gap:6px;padding:6px;border-radius:5px');
      row.onmouseenter = () => row.style.background = 'color-mix(in srgb,var(--A) 12%,transparent)';
      row.onmouseleave = () => row.style.background = 'transparent';
      const parts = (rec.drugs || []).map(d => `${d.label || d.drug}×${d.qty}`).join(' + ');
      const info = document.createElement('div');
      info.setAttribute('style', 'flex:1;min-width:0;cursor:pointer');
      info.innerHTML = `<div style="font-size:12px;font-weight:bold;color:var(--fgbright);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(rec.name)}</div><div style="font-size:9px;font-weight:bold;color:var(--fgdim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(parts)}</div>`;
      info.onclick = () => { AX.confirm(); this.loadRecipe(rec); };
      const del = document.createElement('button');
      del.textContent = '✕'; del.title = 'delete';
      del.setAttribute('style', 'flex:none;background:none;border:none;color:var(--fgdim);font-size:13px;font-weight:bold;cursor:pointer;padding:2px 5px');
      del.onclick = (e) => { e.stopPropagation(); AX.click(); deleteRecipe(rec.name); this.renderRecipes(); this.refreshRecipeBtn(); };
      row.appendChild(info); row.appendChild(del);
      this.rcpPanel.appendChild(row);
    });
  },
  canCommit() { return game.selected.length >= 2 && !!(game.compoundName || '').trim(); },
  sync() { const n = game.selected.length; this.splice.disabled = n < 2;   // enabled at 2 drugs; click shakes the name field until it's filled
    if (n >= 2) this.clampQtys();
    this.hint.textContent = n === 0 ? `drag a drug into the cradle — BASE first, then SPLICE${game.allow3way ? ' (3rd slot open)' : ''}`
      : n === 1 ? 'now drop the splice drug in too'
        : !(game.compoundName || '').trim() ? 'name your compound (left) — then SPLICE ▶'
          : 'set quantities below · SPLICE ▶ or SPACE to begin';
    this.refreshPanels();
    // Live risk telegraph before you commit — server's authoritative composeSplice math.
    if (game.mode !== 'test' && n >= 2) sendCmdSilent('splicepreview ' + b64(this.slots()));
    else if (this.risk) this.risk.textContent = '';
  },
  commit() {
    const sel = game.selected.slice();
    const name = (game.compoundName || '').trim();
    _stash = { selection: sel, instability: game.instability, name };
    if (game.mode === 'test') { transit(game, 'charge'); return; }
    recordRecipe(this.recipeFromState());   // remember it (client-only) for quick recreation
    sendCmdSilent('splicebegin ' + b64({ ...this.slots(), name }));
    game.lab.close();
  },
  topAt(p) { for (let i = this.pkgs.length - 1; i >= 0; i--) { const k = this.pkgs[i]; if (Math.hypot(p.x - k.x, p.y - k.y) < 44) return k; } return null; },
  move(p) { if (this.drag && !this.moved && Math.hypot(p.x - this.pressP.x, p.y - this.pressP.y) > 6) this.moved = true;
    this.hover = this.drag || this.topAt(p); game.lab.canvas.style.cursor = this.hover ? (this.drag ? 'grabbing' : 'grab') : 'default'; },
  down(p) { const k = this.topAt(p); if (!k) { hideLabel(); return; }
    this.drag = k; k.held = true; k.gdx = k.x - p.x; k.gdy = k.y - p.y; this.pressP = { x: p.x, y: p.y }; this.pressT = this.t; this.moved = false;
    this.pkgs.splice(this.pkgs.indexOf(k), 1); this.pkgs.push(k);
    if (k.inCradle) { k.inCradle = false; game.selected = game.selected.filter(d => d !== k.d); this.sync(); }
    AX.clink(); },
  up() { const k = this.drag; if (!k) return; this.drag = null; k.held = false;
    if (!this.moved && (this.t - this.pressT) < 0.25) { if (_labelFor === k.d && _labelEl) hideLabel(); else showLabel(k.d, k.home.x, k.home.y); return; }
    if (Math.hypot(k.x - this.cradle.x, k.y - this.cradle.y) < this.cradle.r + 12) {
      if (game.selected.length >= (game.allow3way ? 3 : 2) && !game.selected.includes(k.d)) { game.lab.ticker(game.allow3way ? "three's the limit — base + two splices." : "two's the limit — a base and a splice.", 'a'); AX.bad(); }
      else { k.inCradle = true; if (!game.selected.includes(k.d)) game.selected.push(k.d); AX.drop(); this.sync(); }
    } else AX.tick();
    hideLabel(); },
  key(e) {
    // Batch quantity: +/− for the base, [ ] for the splice (once both are in).
    if (game.selected.length >= 2 && '+=-_[]{}'.includes(e.key)) {
      e.preventDefault();
      if (e.key === '+' || e.key === '=') game.qtyBase++;
      else if (e.key === '-' || e.key === '_') game.qtyBase--;
      else if (e.key === ']' || e.key === '}') game.qtySplice++;
      else if (e.key === '[' || e.key === '{') game.qtySplice--;
      AX.tick(); this.sync(); return;
    }
    if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); if (this.canCommit()) { AX.confirm(); this.commit(); } else if (game.selected.length >= 2) { this.nameEl.focus(); } }
    else if (e.key === 'c' || e.key === 'C') { AX.click(); this.pkgs.forEach(p => p.inCradle = false); game.selected = []; this.sync(); }
  },
  spillAlarm() { this._spillT = 0.35; if (this.t - this._alarmT > 0.55) { AX.alarm(); this._alarmT = this.t; } },
  update(dt) { this.t += dt; this._spillT = Math.max(0, this._spillT - dt); const cr = this.cradle, inC = this.pkgs.filter(p => p.inCradle);
    this.pkgs.forEach(p => { let tx, ty, k = p.k;
      if (this.drag === p) { tx = ptr.x + p.gdx; ty = ptr.y + p.gdy; }
      else if (p.inCradle) { const idx = inC.indexOf(p), n = inC.length, a = -Math.PI / 2 + (idx - (n - 1) / 2) * 0.52; tx = cr.x + Math.cos(a) * 48; ty = cr.y + Math.sin(a) * 22 - 6; k *= 1.5; }
      else { tx = p.home.x; ty = p.home.y; }
      const ax = (tx - p.x) * k - p.vx * p.c, ay = (ty - p.y) * k - p.vy * p.c; p.vx += ax * dt; p.vy += ay * dt;
      const sp = Math.hypot(p.vx, p.vy); if (sp > 1000) { p.vx *= 1000 / sp; p.vy *= 1000 / sp; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.tilt = lerp(p.tilt, clamp(-p.vx * TILT_GAIN, -0.7, 0.7), dt * 8);
      const dax = p.vx - p.pvx; p.pvx = p.vx;
      const _sp = Math.hypot(p.vx, p.vy), _over = Math.max(0, _sp - SWEEP_SPEED); p.sloshV += (dax * SWAY_SENS + Math.sign(p.vx || 1) * _over * SWEEP_GAIN) * p.fluid; p.sloshV += (-p.slosh * 38 - p.sloshV * 3.6) * dt; p.slosh = clamp(p.slosh + p.sloshV * dt, -1.5, 1.5);
      const speed = Math.hypot(p.vx, p.vy);
      const hz = this.drag === p ? pourHazard(p, speed) : null;
      if (hz) {
        p.warn = hz.level > 0.55 ? clamp(hz.level, 0, 1) : 0;   // the vessel itself glows as its contents near the lip
        if (hz.hazard) bleedFromLip(this, p, hz, dt);
      } else p.warn = lerp(p.warn, 0, dt * 4);
    });
    this.drips.forEach(d => { d.life += dt; d.y += d.vy * dt; d.vy += 400 * dt; }); this.drips = this.drips.filter(d => d.life < 0.6);
  },
  draw() { const cr = this.cradle, base = this.base;
    drawSideTable(W * 0.06, W * 0.46, base);
    const pulse = .5 + .5 * Math.sin(this.t * 3);
    const cg = G.createRadialGradient(cr.x, cr.y, 6, cr.x, cr.y, cr.r + 34); cg.addColorStop(0, `rgba(79,224,138,${.13 + pulse * .1})`); cg.addColorStop(1, 'rgba(79,224,138,0)');
    G.fillStyle = cg; G.beginPath(); G.ellipse(cr.x, cr.y, cr.r + 34, cr.r * .62, 0, 0, 7); G.fill();
    G.strokeStyle = 'rgba(120,150,150,.5)'; G.lineWidth = 3; G.beginPath(); G.ellipse(cr.x, cr.y + 4, cr.r * .78, cr.r * .36, 0, 0.1, Math.PI - 0.1, false); G.stroke();
    G.strokeStyle = 'rgba(79,224,138,.4)'; G.setLineDash([7, 6]); G.lineWidth = 1.6; G.beginPath(); G.ellipse(cr.x, cr.y, cr.r, cr.r * .5, 0, 0, 7); G.stroke(); G.setLineDash([]);
    G.save(); textShadowOn(); G.fillStyle = dimCol(); G.font = 'bold 11px monospace'; G.textAlign = 'center'; G.fillText('REACTION CRADLE', cr.x, cr.y + cr.r * .5 + 18); G.restore();
    this.drips.forEach(d => { G.globalAlpha = 1 - d.life / 0.6; G.fillStyle = d.col; G.beginPath(); G.arc(d.x, d.y, 2.2, 0, 7); G.fill(); }); G.globalAlpha = 1;
    this.pkgs.forEach(p => { const groundY = p.inCradle ? cr.y + 26 : base, lift = clamp((groundY - p.y) / 120, 0, 1);
      G.save(); G.globalAlpha = .42 * (1 - lift * .5); G.fillStyle = '#000'; G.beginPath(); G.ellipse(p.x, groundY, 20 + lift * 8, 5, 0, 0, 7); G.fill(); G.restore();
      drawPackage(p.d, p.x, p.y, p.inCradle, this.hover === p || this.drag === p, this.t, { tilt: p.tilt, slosh: p.slosh, warn: p.warn, held: this.drag === p, fill: p.remaining }); });
    drawCarryWarn(this);
  },
};

// DECANT — carry each chosen drug from the side table to the POUR ZONE and hold
// it steady to decant. Jostle it while carrying and it slops (drips + lost product).
// (Internal stage key stays 'charge'; only the player-facing wording is "Decant".)
STAGES.charge = {
  enter() {
    const g = game; this.t = 0; this.hover = null; this.drag = null; this.fill = 0; this.pouredCount = 0; this.drips = []; this._done = false;
    this._spillT = 0; this._alarmT = 0; this.lost = 0;
    this.beaker = { x: W * 0.73, y: H * 0.52, w: 140, h: 200 };
    this.zone = { x: this.beaker.x, y: this.beaker.y - this.beaker.h / 2 - 34, r: 46 };
    const homes = tableHomes(g.selected.length);
    this.cans = g.selected.map((d, i) => { const hx = homes[i].x, hy = homes[i].y, w = 2 * Math.PI * (FORM_FREQ[d.form] || 2.2), k = w * w, c = 2 * 0.62 * w;
      return { d, home: { x: hx, y: hy }, x: hx, y: hy, vx: 0, vy: 0, pvx: 0, tilt: 0, slosh: 0, sloshV: 0, held: false, gdx: 0, gdy: 0, k, c, fluid: FORM_FLUID[d.sub] ?? .3, poured: 0, done: false, remaining: 1, warn: 0, pourSfx: false }; });
    g.lab.ticker('DECANT — carry each drug from the table to the POUR ZONE and hold it steady to decant. jostle it and it slops.');
    this.hint = mkEl('position:absolute;left:50%;top:40px;transform:translateX(-50%);color:var(--fgdim);font-size:13px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;pointer-events:none;text-shadow:0 0 6px color-mix(in srgb,var(--bg,#05050a) 85%,transparent)');
  },
  exit() { AX.pour(false); game.lab.canvas.style.cursor = 'default'; },
  topAt(p) { for (let i = this.cans.length - 1; i >= 0; i--) { const k = this.cans[i]; if (!k.done && Math.hypot(p.x - k.x, p.y - k.y) < 44) return k; } return null; },
  move(p) { this.hover = this.drag || this.topAt(p); game.lab.canvas.style.cursor = this.hover ? (this.drag ? 'grabbing' : 'grab') : 'default'; },
  down(p) { const k = this.topAt(p); if (!k) return; this.drag = k; k.held = true; k.gdx = k.x - p.x; k.gdy = k.y - p.y; this.cans.splice(this.cans.indexOf(k), 1); this.cans.push(k);
    AX.clink(); },
  up() { const k = this.drag; if (!k) return; this.drag = null; k.held = false; if (k.pourSfx) { k.pourSfx = false; AX.pour(false); } },
  spillAlarm() { this._spillT = 0.35; if (this.t - this._alarmT > 0.55) { AX.alarm(); this._alarmT = this.t; } },
  update(dt) { this.t += dt; this._spillT = Math.max(0, this._spillT - dt); const z = this.zone;
    this.cans.forEach(p => { if (p.done) return;
      let tx, ty; if (this.drag === p) { tx = ptr.x + p.gdx; ty = ptr.y + p.gdy; } else { tx = p.home.x; ty = p.home.y; }
      const ax = (tx - p.x) * p.k - p.vx * p.c, ay = (ty - p.y) * p.k - p.vy * p.c; p.vx += ax * dt; p.vy += ay * dt;
      const spd = Math.hypot(p.vx, p.vy); if (spd > 1000) { p.vx *= 1000 / spd; p.vy *= 1000 / spd; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const dax = p.vx - p.pvx; p.pvx = p.vx; const _sp = Math.hypot(p.vx, p.vy), _over = Math.max(0, _sp - SWEEP_SPEED); p.sloshV += (dax * SWAY_SENS + Math.sign(p.vx || 1) * _over * SWEEP_GAIN) * p.fluid; p.sloshV += (-p.slosh * 38 - p.sloshV * 3.6) * dt; p.slosh = clamp(p.slosh + p.sloshV * dt, -1.5, 1.5);
      const inZone = Math.hypot(p.x - z.x, p.y - z.y) < z.r, steady = spd < 130 && Math.abs(p.slosh) < 0.55;
      if (this.drag === p && inZone && steady) {
        p.tilt = lerp(p.tilt, -0.7, dt * 4); p.poured = clamp(p.poured + dt * 0.7, 0, 1); p.remaining = 1 - p.poured; this.fill = this.pouredFill();
        if (!p.pourSfx) { p.pourSfx = true; AX.pour(true); }
        if (p.poured >= 1 && !p.done) { p.done = true; this.pouredCount++; AX.pour(false); AX.drop(); this.drag = null; p.held = false; }
      } else {
        p.tilt = lerp(p.tilt, clamp(-p.vx * TILT_GAIN, -0.7, 0.7), dt * 8);
        if (p.pourSfx) { p.pourSfx = false; AX.pour(false); }
        if (this.drag === p) { const hz = pourHazard(p, spd);
          p.warn = hz.level > 0.55 ? clamp(hz.level, 0, 1) : 0;   // the vessel itself glows as its contents near the lip
          if (hz.hazard) bleedFromLip(this, p, hz, dt);
        } else p.warn = lerp(p.warn, 0, dt * 4);
      }
    });
    this.drips.forEach(d => { d.life += dt; d.y += d.vy * dt; d.vy += 400 * dt; }); this.drips = this.drips.filter(d => d.life < 0.6);
    this.hint.textContent = `${this.pouredCount} / ${game.selected.length} decanted`;
    if (this.pouredCount >= game.selected.length && !this._done) { this._done = true; game._charged = true; AX.good(); game.lab.ticker('decanted. into the mix.'); setTimeout(() => { if (game && !game.closed) transit(game, 'mix'); }, 500); }
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
      drawPackage(p.d, p.x, p.y, false, this.hover === p || this.drag === p, this.t, { tilt: p.tilt, slosh: p.slosh, warn: p.warn, held: this.drag === p, fill: p.remaining });
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
      G.save(); textShadowOn(); G.textAlign = 'center'; G.fillStyle = dimCol(); G.font = 'bold 11px monospace'; G.fillText(`${(d.known ?? 1) > .4 ? d.name : 'UNKNOWN'} · ${this.idx + 1}/${this.queue.length}`, b.x, cy - 54);
      G.fillStyle = brightCol(); G.font = 'bold 14px monospace'; G.fillText(this.label, b.x, cy - 40); G.restore();
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
      G.save(); textShadowOn(); G.fillStyle = dimCol(); G.font = 'bold 12px monospace'; G.textAlign = 'center'; G.fillText(`POURING: ${s.name}`, b.x, b.y - b.h / 2 - 28);
      G.fillStyle = s.touchy ? '#9a5ce0' : '#4fe08a'; G.font = 'bold 14px monospace'; G.fillText(`${this.stepIdx + 1} / ${this.steps.length}`, b.x, b.y - b.h / 2 - 12); G.restore();
    }
  },
};

STAGES.stir = {
  enter() { const g = game; this.t = 0; this.angle = 0; this.rpm = 0; this.spin = 0; this.lastA = null; this.holdT = 0; this.need = 5.5;
    this.targetRpm = 0.55; this.band = clamp(.22 - g.diff() * .008, .1, .22); this.keyDir = 0; this.beaker = { x: W / 2, y: H * 0.5, w: 150, h: 210 }; this.ended = false;
    g.lab.ticker('STIR — trace circles over the beaker (or hold ← / →). hold the rod in the green RPM band.');
    this.bar = mkEl('position:absolute;left:50%;top:40px;transform:translateX(-50%);color:var(--fgdim);font-size:13px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;pointer-events:none;text-shadow:0 0 6px color-mix(in srgb,var(--bg,#05050a) 85%,transparent)');
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
    G.save(); textShadowOn(); G.fillStyle = dimCol(); G.font = 'bold 10px monospace'; G.textAlign = 'center'; G.fillText('RPM', cx, cy + R + 14); G.restore();
  },
};

STAGES.heat = {
  enter() { const g = game; this.t = 0; this.dur = 15; this.level = .5; this.vel = 0; this.hold = false; this.inBand = 0; this.ended = false;
    const d = g.diff(); this.gravity = 0.8 + d * .04; this.push = 1.7 + d * .04; this.bandHalf = clamp(.20 - d * .006, .09, .20); this.bandSpeed = .09 + d * .018;
    this.beaker = { x: W / 2, y: H * 0.48, w: 120, h: 230 }; this.bubbles = []; this.heatS = 0;
    g.lab.ticker('STABILIZE — hold to heat, keep the reagent in the green band. let it run away and it bites.');
    this.bar = mkEl('position:absolute;left:50%;top:40px;transform:translateX(-50%);color:var(--fgdim);font-size:13px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;pointer-events:none;text-shadow:0 0 6px color-mix(in srgb,var(--bg,#05050a) 85%,transparent)');
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
    G.save(); textShadowOn(); G.fillStyle = dimCol(); G.font = 'bold 12px monospace'; G.textAlign = 'center'; G.fillText('STABILIZE THE REACTION', b.x, b.y - b.h / 2 - 14); G.restore();
  },
};

STAGES.rhythm = {
  enter() { const g = game; this.t = 0; this.beats = []; this.done = false; this.flashT = 0; this.shake = 0;
    const bpm = 78 + g.diff() * 6; this.interval = 60 / bpm; this.window = clamp(.16 - g.diff() * .006, .06, .16); this.lead = 2.0;
    for (let i = 0; i < 8; i++) this.beats.push({ time: this.lead + i * this.interval, hit: null });
    this.beaker = { x: W / 2, y: H * 0.5, w: 150, h: 200 };
    g.lab.ticker('SET — strike SPACE on each pulse. lock the lattice. this is the part everyone rushes and ruins.');
    this.judgements = []; this.nextMetro = this.lead;
    this.readout = mkEl('position:absolute;left:50%;top:40px;transform:translateX(-50%);color:var(--fgdim);font-size:15px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;pointer-events:none;min-width:120px;text-align:center;text-shadow:0 0 6px color-mix(in srgb,var(--bg,#05050a) 85%,transparent)');
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
    textShadowOn(); G.fillStyle = dimCol(); G.font = 'bold 12px monospace'; G.textAlign = 'center'; G.fillText('◄ STRIKE ON THE RING ►', cx, cy - 56);
    G.restore();
  },
};

// PACKAGE — the closing beat (test flow): the stable batch pours into a jar, you
// stamp the label with the name you gave it, and it's logged. Then the result card.
STAGES.package = {
  enter() { const g = game; this.t = 0; this.fill = 0; this.sealed = false; this.stampA = 0;
    this.beaker = { x: W / 2, y: H * 0.52, w: 130, h: 200 };
    this.col = avgColor(g.selected); this.potency = computePotency();
    this.grade = gradeForAvg((g.scores.mix + g.scores.pour + g.scores.stir + g.scores.heat + g.scores.rhythm) / 5);
    g.lab.ticker('PACKAGE — the batch is stable. jar it and stamp the label.');
    this.b = mkBtn('SEAL & LABEL', 'left:50%;bottom:40px;transform:translateX(-50%)'); this.b.disabled = true;
    this.b.onclick = () => this.seal();
    AX.loop('hood', { freq: 58, type: 'sawtooth', gain: .03, filt: 340, tremRate: 7, tremDepth: .25 });
  },
  exit() { AX.stop('hood'); },
  seal() { if (this.sealed || this.b.disabled) return; this.sealed = true; this.b.disabled = true; AX.confirm(); AX.drop();
    game.lab.flash(mixColors(this.col, '#ffffff', .3)); game.lab.ticker('logged to the chem-lab vault.', 'b');
    setTimeout(() => { if (game && !game.closed) showResult(false); }, 800); },
  down() { this.seal(); },
  key(e) { if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); this.seal(); } },
  update(dt) { this.t += dt;
    if (this.fill < 1) { this.fill = clamp(this.fill + dt * 0.7, 0, 1); if (this.fill >= 1 && this.b.disabled && !this.sealed) { this.b.disabled = false; AX.good(); } }
    if (this.sealed) this.stampA = clamp(this.stampA + dt * 4, 0, 1);
  },
  draw() { const b = this.beaker;
    drawBeaker(b, () => { const base = b.y + b.h / 2, top = base - (b.h * 0.66) * this.fill; if (this.fill > 0.001) fillLiquid(b.x - b.w / 2, b.w, top, base, this.col, this.col, this.t, 0.12, 0.25); });
    drawSteam(b.x, b.y - b.h * 0.22, (1 - this.fill) * 0.4 + 0.08, this.t, '210,235,225');
    if (this.fill < 1) { G.strokeStyle = this.col; G.globalAlpha = .8; G.lineWidth = 3; G.beginPath(); G.moveTo(b.x, b.y - b.h / 2 - 60); G.lineTo(b.x + Math.sin(this.t * 30) * 2, b.y - b.h / 2 - 4); G.stroke(); G.globalAlpha = 1; }
    // adhesive label on the glass
    const lx = b.x - 58, ly = b.y - 4, lw = 116, lh = 56;
    G.save(); G.fillStyle = 'rgba(242,246,250,.94)'; roundRect(lx, ly, lw, lh, 4); G.fill();
    G.strokeStyle = shade(this.col, -20); G.lineWidth = 1.5; roundRect(lx, ly, lw, lh, 4); G.stroke();
    G.fillStyle = this.col; G.fillRect(lx, ly, lw, 4);
    G.textAlign = 'center'; G.fillStyle = '#0c1114'; G.font = 'bold 13px monospace';
    G.fillText((game.compoundName || 'UNNAMED').toUpperCase().slice(0, 16), b.x, ly + 24);
    G.font = '8px monospace'; G.fillStyle = '#3a4a52';
    G.fillText('CHIMERA-9 · ' + this.potency.toFixed(2) + '× POTENCY', b.x, ly + 38);
    G.fillText('BATCH GRADE ' + this.grade, b.x, ly + 50);
    if (this.stampA > 0.02) { G.save(); G.globalAlpha = this.stampA * (0.7 + 0.3 * Math.sin(this.t * 18)); G.translate(b.x + 40, ly + 34); G.rotate(-0.28); G.scale(2 - this.stampA, 2 - this.stampA);
      G.strokeStyle = '#b3122a'; G.lineWidth = 2.5; roundRect(-32, -12, 64, 24, 3); G.stroke(); G.fillStyle = '#b3122a'; G.font = 'bold 12px monospace'; G.textAlign = 'center'; G.fillText('SEALED', 0, 4); G.restore(); }
    G.restore();
    G.save(); textShadowOn(); G.fillStyle = dimCol(); G.font = 'bold 12px monospace'; G.textAlign = 'center'; G.fillText(this.fill < 1 ? 'JARRING THE BATCH…' : (this.sealed ? 'LOGGED' : 'STAMP THE LABEL'), b.x, b.y - b.h / 2 - 12); G.restore();
  },
};

// ── resolve ──────────────────────────────────────────────────────────────────
function aggScore() { const s = game.scores; const avg = (s.mix + s.pour + s.stir + s.heat + s.rhythm) / 5; return clamp(Math.round(avg * 100 - game.instability * 0.3), 0, 100); }
function resolveReal() { const score = aggScore(); game.lab.ticker('sequence complete — resolving…', ''); AX.good();
  const cb = game.onResolve; setTimeout(() => { const g = game; if (g) g.lab.close(); if (cb) cb({ score }); }, 850); }

// test-mode only: client-side catastrophe, then the packaging beat → result card (dev feel-test)
function finalizeTest() { if (!game.blown && Math.random() < catastropheChance()) { catastrophe('the final set'); return; } transit(game, 'package'); }
function catastrophe(reason) { const g = game; g.blown = true; AX.klaxon(); AX.shatter(); g.lab.flash('#ff4a5b');
  const parts = []; for (let i = 0; i < 60; i++) parts.push({ x: W / 2, y: H / 2, vx: rnd(400, -400), vy: rnd(-100, -460), life: 0, col: Math.random() < .5 ? avgColor(g.selected) : '#dfeef0' });
  let pt = performance.now();
  (function burst(now) { if (g.closed) return; const dt = (now - pt) / 1000; pt = now;
    parts.forEach(p => { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 800 * dt; G.globalAlpha = clamp(1 - p.life / 1.4, 0, 1); G.fillStyle = p.col; G.beginPath(); G.arc(p.x, p.y, rnd(3, 1), 0, 7); G.fill(); }); G.globalAlpha = 1;
    if (parts[0].life < 1.4) requestAnimationFrame(burst); })(pt);
  setTimeout(() => showResult(true), 700);
}
function computePotency() { const s = game.scores; const avg = (s.mix + s.pour + s.stir + s.heat + s.rhythm) / 5; return clamp(0.55 + avg * 0.9 - game.instability / 100 * 0.5, 0.3, 1.7); }
// A+…F from the averaged run — mirrors the server's report-card bands so the dev
// test verdict reads like the real end card.
function gradeForAvg(avg) { return avg >= 0.90 ? 'A+' : avg >= 0.78 ? 'A' : avg >= 0.64 ? 'B' : avg >= 0.50 ? 'C' : avg >= 0.35 ? 'D' : 'F'; }
const GRADE_COL = { 'A+': '#39ff9e', 'A': '#39ff9e', 'B': '#ffc24d', 'C': '#ffb14d', 'D': '#ff8a5a', 'F': '#ff4a5b' };
function showResult(blown) {
  const g = game; const potency = blown ? 0 : computePotency();
  const s = g.scores; const avg = (s.mix + s.pour + s.stir + s.heat + s.rhythm) / 5;
  const grade = blown ? 'F' : gradeForAvg(avg); const gcol = GRADE_COL[grade];
  const nm = (g.compoundName || '').trim().toUpperCase() || 'UNNAMED COMPOUND';
  const card = document.createElement('div');
  card.setAttribute('style', 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;background:radial-gradient(120% 90% at 50% 40%,color-mix(in srgb,var(--bg,#05050a) 55%,transparent),color-mix(in srgb,var(--bg,#05050a) 94%,transparent));pointer-events:auto');
  const rows = ['mix|MIX', 'pour|POUR', 'stir|AGITATION', 'heat|STABILITY', 'rhythm|SET'].map(r => { const [k, lbl] = r.split('|'); const p = Math.round(g.scores[k] * 100); return `<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--fgdim);margin:4px 24px"><span>${lbl}</span><b style="color:${p >= 75 ? 'var(--A)' : p >= 45 ? 'var(--orange,#ffb23e)' : 'var(--red,#ff4a5b)'}">${p}%</b></div>`; }).join('');
  card.innerHTML = `<div class="lab-card">
    <div style="font-size:52px;font-weight:bold;line-height:1;color:${gcol};text-shadow:0 0 18px ${gcol}66;margin-bottom:2px">${grade}</div>
    <div style="font-size:19px;letter-spacing:2px;color:${blown ? 'var(--red,#ff4a5b)' : 'var(--A)'};font-weight:bold">${blown ? 'BATCH LOST' : esc(nm)}</div>
    <div style="font-size:9px;letter-spacing:3px;color:var(--fgdim);text-transform:uppercase;margin:4px 0 14px">${blown ? 'CATASTROPHIC FAILURE' : (potency > 1.3 ? 'POTENT · VOLATILE' : 'CHIMERA-9 · SEALED')}</div>
    ${rows}
    <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--fgdim);margin:8px 24px 0;padding-top:8px;border-top:1px solid color-mix(in srgb,var(--A) 22%,transparent)"><span>POTENCY</span><b style="color:${blown ? 'var(--red,#ff4a5b)' : 'var(--A)'}">${blown ? '—' : potency.toFixed(2) + '×'}</b></div>
    <div style="font-size:10px;color:var(--fgdim);font-style:italic;margin:14px 20px">${blown ? "It's gone. Glass everywhere, and the smell will linger." : 'Logged to the chem-lab vault. On the real bench, the server decides how it lands.'}</div>
    <button class="lab-btn" style="position:static;margin-top:6px">✕ CLOSE</button></div>`;
  g.lab.ui.appendChild(card);
  card.querySelector('button').onclick = () => g.lab.close();
  AX.tone(blown ? 120 : 520, .4, { type: blown ? 'sawtooth' : 'triangle', gain: .2, to: blown ? 60 : 780 });
}

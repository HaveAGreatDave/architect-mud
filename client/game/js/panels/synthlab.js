// SYNTH LAB — the "stabilize the reaction" cooking minigame.
//
// A reaction level bobs inside a glass vial: it falls under gravity and rises
// while you apply heat from the burner beneath it (hold mouse / space). A
// drifting SAFE BAND narrows with recipe difficulty. Your score = fraction of
// time you kept the level inside the band.
//
// Cosmetically it's a lab bench: a bulged-glass vial of luminous reagent that
// bubbles and steams over a Bunsen flame that flares as you feed it heat, all
// mounted in the shared futuristic terminal chassis (mg-chassis / CRT bezel /
// deck strip) the other minigames use. A live burner-roar loop rides its gain
// with the flame; bubbling, ignition and stabilise/drift chimes are one-shots.
//
// Launched by the `synth_minigame` server message (see dispatch.js). On finish,
// opts.onResult({score}) fires `synthresolve <recipeId> <score>`; the server
// rolls the authoritative chemistry check and folds this 0–100 score into the
// margin (better cook → higher potency). Aborting (Esc) does NOT resolve — the
// cook is simply abandoned, reagents intact.

import { sfx, ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays, deckStrip, setDeckLevel } from './minigame-common.js';

let _overlay = null, _raf = null, _keyDown = null, _keyUp = null, _opts = null, _st = null;

// Live burner roar — a lowpassed noise bed whose gain we ride with the flame,
// with occasional bubbles baked in as sparkles so the vial always simmers. Kept
// local (like the TV hum) rather than in the catalog because it's a ridden loop.
const BURNER_LOOP = { id: 'synth_burner_loop', category: 'sfx', priority: 2, loop: true, config: {
  waveform: 'noise', noiseMix: 1, gain: 0.13,
  filter: { type: 'lowpass', freq: 520, q: 1.4 },
  tremolo: { rate: 11, depth: 0.35 },
  adsr: { a: 0.25, d: 0.1, s: 1, r: 0.35 },
  sparkle: [ { everyMin: 0.4, everyMax: 1.2, prob: 0.9, gain: 0.45, duration: 0.16, jitter: 0.4, layers: [
    { waveform: 'sine', freq: 200, pitchBend: { to: 460, time: 0.09 }, filter: { type: 'lowpass', freq: 1100, q: 2 }, adsr: { a: 0.005, d: 0.1, s: 0, r: 0.05 }, gain: 0.5 } ] } ],
} };

function ensureStyles() {
  if (document.getElementById('synth-lab-styles')) return;
  const s = document.createElement('style');
  s.id = 'synth-lab-styles';
  s.textContent = `
  #synth-lab-overlay { --mg-accent:#4fe08a; position:fixed; inset:0; z-index:9996; display:flex; align-items:center; justify-content:center;
    background:rgba(2,6,4,0.8); backdrop-filter:blur(3px); font-family:var(--font-mono,monospace); }
  #synth-lab-overlay .sl-panel { width:340px; padding:14px 16px 16px; color:#cfe9d8;
    background:linear-gradient(180deg,#141b16 0%,#0e150f 8%,#0a120c 40%,#060b08 100%); animation:sl-boot .3s ease-out; }
  @keyframes sl-boot { 0%{opacity:0;transform:scale(.985)} 100%{opacity:1;transform:scale(1)} }
  #synth-lab-overlay .sl-hud { display:flex; justify-content:space-between; align-items:center; color:#9fc7ac; font-size:11px; letter-spacing:1px; padding:8px 2px 6px; }
  #synth-lab-overlay .sl-hud b { color:#4fe08a; font-weight:bold; }
  #synth-lab-overlay .sl-stagewrap { position:relative; background:radial-gradient(120% 90% at 50% 30%, #06110b, #020604 82%); border-radius:8px; padding:6px 4px; }
  #synth-lab-overlay .sl-stagewrap canvas { display:block; margin:0 auto; }
  #synth-lab-overlay .sl-result { color:#7fffb0; text-align:center; font-size:14px; letter-spacing:1px; min-height:18px; padding:8px 2px 2px; font-weight:bold; }
  #synth-lab-overlay .sl-result .sl-win { color:#5cff9a; } #synth-lab-overlay .sl-result .sl-mid { color:#e0b64f; } #synth-lab-overlay .sl-result .sl-lose { color:#e0644f; }
  #synth-lab-overlay .sl-hint { color:#5f7f6a; font-size:9px; text-align:center; letter-spacing:0.5px; padding:2px 2px 0; }
  `;
  document.head.appendChild(s);
}

export function openSynthMinigame(opts = {}) {
  ensureStyles();
  ensureChassisStyles();
  close();
  _opts = { difficulty: 5, recipeName: 'COMPOUND', workspace: '', hard: false, onResult: null, ...opts };
  const hard = _opts.hard;
  const diff = Math.max(1, Math.min(hard ? 16 : 10, _opts.difficulty));

  const overlay = document.createElement('div');
  overlay.id = 'synth-lab-overlay';
  overlay.innerHTML = `
    <div class="sl-panel mg-chassis">
      ${deviceHeader('&#9879;', 'SYNTH LAB', (hard ? 'SPLICE &middot; ' : 'COOK &middot; ') + String(_opts.recipeName).toUpperCase())}
      <div class="sl-hud"><span>REACTION <b id="sl-stab">0%</b> STABLE</span><span id="sl-time">14.0s</span></div>
      <div class="mg-bezel">${bezelScrews()}
        <div class="mg-screen" style="--mg-sweep-h:322px">
          <div class="sl-stagewrap"><canvas id="synth-canvas" width="312" height="322"></canvas></div>
          ${crtOverlays()}
        </div>
      </div>
      <div class="sl-result" id="sl-result"></div>
      <div class="sl-hint">HOLD mouse / SPACE to feed the burner — keep the reagent in the green band. Esc aborts.</div>
      ${deckStrip('REACTION CHAMBER', 'DRIFT')}
    </div>`;
  document.body.appendChild(overlay);
  _overlay = overlay;
  overlay.querySelector('.mg-close')?.addEventListener('click', close);

  const canvas = overlay.querySelector('#synth-canvas');
  const ctx = canvas.getContext('2d');

  _st = {
    ctx, w: canvas.width, h: canvas.height,
    level: 0.5, vel: 0, holding: false,
    t: 0, dur: hard ? 16 : 14, inBand: 0, last: performance.now(),
    heatSmooth: 0, flick: 0, spawnAcc: 0, bubbles: [], vapor: [], wasInBand: false, lastGain: -1,
    // difficulty tuning (harder splice mode = narrower, faster-drifting band)
    gravity: (hard ? 1.1 : 0.95) + diff * 0.04,
    push: (hard ? 2.05 : 1.9) + diff * 0.05,
    bandHalf: Math.max(hard ? 0.045 : 0.06, (hard ? 0.14 : 0.17) - diff * (hard ? 0.007 : 0.009)),
    bandSpeed: (hard ? 0.26 : 0.18) + diff * (hard ? 0.05 : 0.045),
    over: false,
  };

  const setHold = (v) => {
    if (!_st || _st.holding === v) return;
    _st.holding = v;
    if (v) sfx('synth-ignite');
  };
  overlay.addEventListener('mousedown', (e) => { if (e.button === 0) setHold(true); });
  window.addEventListener('mouseup', () => setHold(false));
  _keyDown = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); setHold(true); }
  };
  _keyUp = (e) => { if (e.code === 'Space' || e.key === ' ') setHold(false); };
  window.addEventListener('keydown', _keyDown);
  window.addEventListener('keyup', _keyUp);

  window.AudioEngine?.init?.();
  sfx('synth-entry');
  window.AudioEngine?.loopSound?.(BURNER_LOOP);
  window.AudioEngine?.setLoopGain?.(BURNER_LOOP.id, 0.3, 0.2);

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
  st.flick += dt;
  // Smoothed heat drives flame height, bubble rate and burner-roar gain.
  st.heatSmooth += ((st.holding ? 1 : 0) - st.heatSmooth) * Math.min(1, dt * 6);

  const center = bandCenter(st);
  const inBand = Math.abs(st.level - center) <= st.bandHalf;
  if (inBand) st.inBand += dt;

  // Band-crossing chimes (skip the first frames so it doesn't fire on open).
  if (st.t > 0.4 && inBand !== st.wasInBand) sfx(inBand ? 'synth-inband' : 'synth-outband');
  st.wasInBand = inBand;

  // Ride the burner roar with the flame (throttled — only on meaningful change).
  const gain = 0.3 + 0.7 * st.heatSmooth;
  if (Math.abs(gain - st.lastGain) > 0.04) { window.AudioEngine?.setLoopGain?.(BURNER_LOOP.id, gain, 0.08); st.lastGain = gain; }

  updateParticles(st, dt, center);
  render(st, center, inBand);

  const left = Math.max(0, st.dur - st.t);
  _overlay.querySelector('#sl-time').textContent = left.toFixed(1) + 's';
  _overlay.querySelector('#sl-stab').textContent = Math.round((st.inBand / Math.max(0.001, st.t)) * 100) + '%';
  // Deck LEDs read reaction DRIFT — green in-band, amber/red as it wanders off.
  setDeckLevel(_overlay, Math.min(1, Math.abs(st.level - center) / (st.bandHalf * 3)));

  if (st.t >= st.dur) return finish();
  _raf = requestAnimationFrame(loop);
}

// ── Vial geometry ─────────────────────────────────────────────────────────────
// A tall bulged test-tube: straight glass walls with a full semicircle bottom,
// a slightly flared lip on top, sitting over the burner. Fluid fills to `level`.
function vialGeom(st) {
  const { w } = st;
  const cx = w / 2, vw = 84, r = vw / 2;
  const top = 30, bot = 250;                 // glass extent (bottom = tube base centre band)
  const x = cx - r;
  const fluidTop = top + 16, fluidBot = bot; // fluid surface range
  return { cx, vw, r, top, bot, x, fluidTop, fluidBot,
    toY: (lvl) => fluidBot - lvl * (fluidBot - fluidTop) };
}

// Rounded-bottom tube path (semicircle base). Used for both glass and fluid clip.
function tubePath(ctx, g, top) {
  const { x, vw, r, bot } = g;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bot - r);
  ctx.arc(x + r, bot - r, r, Math.PI, 0, true);
  ctx.lineTo(x + vw, top);
}

function updateParticles(st, dt, center) {
  const g = vialGeom(st);
  const surfaceY = g.toY(st.level);
  // Spawn bubbles from the heated base — faster when the flame is up.
  st.spawnAcc += dt * (2 + st.heatSmooth * 16);
  while (st.spawnAcc >= 1 && st.bubbles.length < 48) {
    st.spawnAcc -= 1;
    st.bubbles.push({
      x: g.x + 8 + Math.random() * (g.vw - 16),
      y: g.bot - 6 - Math.random() * 10,
      r: 1 + Math.random() * 2.4,
      spd: 18 + Math.random() * 34 + st.heatSmooth * 26,
      wob: Math.random() * Math.PI * 2,
    });
  }
  for (const b of st.bubbles) { b.y -= b.spd * dt; b.wob += dt * 6; }
  // Retire bubbles that reach the surface, occasionally puffing vapour if hot.
  st.bubbles = st.bubbles.filter(b => {
    if (b.y - b.r <= surfaceY + 1) {
      if (st.heatSmooth > 0.35 && Math.random() < 0.5)
        st.vapor.push({ x: b.x, y: surfaceY, r: 3 + Math.random() * 4, life: 0, ttl: 1.1 + Math.random() * 0.7, drift: (Math.random() - 0.5) * 14 });
      return false;
    }
    return true;
  });
  for (const v of st.vapor) { v.life += dt; v.y -= (10 + st.heatSmooth * 14) * dt; v.x += v.drift * dt; v.r += dt * 3; }
  st.vapor = st.vapor.filter(v => v.life < v.ttl);
}

function render(st, center, inBand) {
  const { ctx, w, h } = st;
  ctx.clearRect(0, 0, w, h);
  const g = vialGeom(st);

  drawBurner(st, g);

  // ── Glass back wall + inner cavity shading ──────────────────────────────────
  ctx.save();
  tubePath(ctx, g, g.top); ctx.closePath();
  const cav = ctx.createLinearGradient(g.x, 0, g.x + g.vw, 0);
  cav.addColorStop(0, 'rgba(20,48,32,0.55)'); cav.addColorStop(0.5, 'rgba(8,20,14,0.15)'); cav.addColorStop(1, 'rgba(20,48,32,0.55)');
  ctx.fillStyle = cav; ctx.fill();
  ctx.restore();

  // ── Fluid (clipped to the tube) ─────────────────────────────────────────────
  const ly = g.toY(st.level);
  const band = inBand ? ['#1f7a48', '#4fe08a'] : (st.level > center ? ['#7a5a1f', '#e0b64f'] : ['#7a2a1f', '#e0644f']);
  ctx.save();
  tubePath(ctx, g, g.top); ctx.closePath(); ctx.clip();

  const grad = ctx.createLinearGradient(0, ly, 0, g.bot);
  grad.addColorStop(0, band[1]); grad.addColorStop(1, band[0]);
  ctx.fillStyle = grad;
  ctx.fillRect(g.x, ly, g.vw, g.bot - ly);

  // safe band glow (only the slice that sits within the fluid column reads best,
  // but drawing it full-height makes the target obvious while aiming)
  const bTop = g.toY(center + st.bandHalf), bBot = g.toY(center - st.bandHalf);
  ctx.fillStyle = inBand ? 'rgba(90,255,150,0.20)' : 'rgba(90,255,150,0.09)';
  ctx.fillRect(g.x, bTop, g.vw, bBot - bTop);
  ctx.strokeStyle = 'rgba(120,255,170,0.55)'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(g.x, bTop); ctx.lineTo(g.x + g.vw, bTop); ctx.moveTo(g.x, bBot); ctx.lineTo(g.x + g.vw, bBot); ctx.stroke();
  ctx.setLineDash([]);

  // rising bubbles
  for (const b of st.bubbles) {
    ctx.beginPath(); ctx.arc(b.x + Math.sin(b.wob) * 1.5, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(210,255,230,0.28)'; ctx.fill();
    ctx.strokeStyle = 'rgba(230,255,240,0.5)'; ctx.lineWidth = 0.6; ctx.stroke();
  }

  // meniscus surface line + glow
  ctx.strokeStyle = band[1]; ctx.lineWidth = 2; ctx.shadowColor = band[1]; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.moveTo(g.x, ly); ctx.lineTo(g.x + g.vw, ly); ctx.stroke();
  ctx.shadowBlur = 0;
  // faint surface highlight ellipse
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath(); ctx.ellipse(g.cx, ly, g.r - 6, 3.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // ── Vapour wisps above the surface ──────────────────────────────────────────
  for (const v of st.vapor) {
    const a = (1 - v.life / v.ttl) * 0.16;
    ctx.beginPath(); ctx.arc(v.x, v.y, v.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(200,240,220,${a.toFixed(3)})`; ctx.fill();
  }

  // ── Glass rim, lip, and specular highlight over everything ───────────────────
  ctx.save();
  tubePath(ctx, g, g.top);
  ctx.lineTo(g.x + g.vw + 5, g.top - 6); // flared lip right
  ctx.moveTo(g.x, g.top); ctx.lineTo(g.x - 5, g.top - 6); // flared lip left
  ctx.strokeStyle = 'rgba(150,220,180,0.7)'; ctx.lineWidth = 2; ctx.stroke();
  // lip band
  ctx.strokeStyle = 'rgba(190,240,210,0.85)'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(g.x - 5, g.top - 6); ctx.lineTo(g.x + g.vw + 5, g.top - 6); ctx.stroke();
  ctx.restore();
  // running specular streak down the left glass
  const spec = ctx.createLinearGradient(g.x, 0, g.x + 18, 0);
  spec.addColorStop(0, 'rgba(255,255,255,0.0)'); spec.addColorStop(0.5, 'rgba(255,255,255,0.22)'); spec.addColorStop(1, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = spec; ctx.fillRect(g.x + 6, g.top + 6, 10, g.bot - g.top - 18);

  // graduation ticks etched on the right glass
  ctx.strokeStyle = 'rgba(150,220,180,0.3)'; ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const yy = g.fluidTop + (g.fluidBot - g.fluidTop) * (i / 8);
    ctx.beginPath(); ctx.moveTo(g.x + g.vw - (i % 2 ? 10 : 15), yy); ctx.lineTo(g.x + g.vw - 2, yy); ctx.stroke();
  }
}

// Bunsen burner + flame under the tube. Flame height/heat track st.heatSmooth;
// a low blue pilot always flickers, roaring up to a tall orange tongue on heat.
function drawBurner(st, g) {
  const { ctx } = st;
  const baseY = g.bot + 34;         // flame origin (nozzle mouth)
  const cx = g.cx;
  const heat = st.heatSmooth;
  const flick = 0.85 + 0.15 * Math.sin(st.flick * 22) + (Math.random() - 0.5) * 0.12;
  const H = (26 + heat * 78) * flick;   // total flame height
  const sway = Math.sin(st.flick * 7) * (2 + heat * 4);

  // heat haze / glow pooled under the tube
  const glow = ctx.createRadialGradient(cx, baseY - H * 0.4, 4, cx, baseY - H * 0.4, 52 + heat * 30);
  glow.addColorStop(0, `rgba(255,150,40,${(0.12 + heat * 0.28).toFixed(3)})`);
  glow.addColorStop(1, 'rgba(255,150,40,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(cx - 90, baseY - H - 40, 180, H + 60);

  // flame tongues, outer → inner (additive-ish via screen blend)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  flameTongue(ctx, cx, baseY, 15 + heat * 5, H, sway, 'rgba(230,90,20,0.85)', 14);
  flameTongue(ctx, cx, baseY, 11 + heat * 3, H * 0.82, sway * 0.8, 'rgba(255,170,40,0.9)', 10);
  flameTongue(ctx, cx, baseY, 7 + heat * 2, H * 0.6, sway * 0.6, 'rgba(255,235,150,0.95)', 6);
  // blue base cone (always present — the pilot)
  flameTongue(ctx, cx, baseY, 8, 14 + heat * 10, sway * 0.3, 'rgba(90,150,255,0.6)', 6);
  flameTongue(ctx, cx, baseY, 4, 8 + heat * 5, 0, 'rgba(180,220,255,0.7)', 3);
  ctx.restore();

  // burner barrel + collar beneath the flame
  const bw = 22, bx = cx - bw / 2, by = baseY + 2, bh = st.h - by - 4;
  const bg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  bg.addColorStop(0, '#2a3138'); bg.addColorStop(0.5, '#6b747d'); bg.addColorStop(1, '#20262b');
  ctx.fillStyle = bg; ctx.fillRect(bx, by, bw, Math.max(10, bh));
  ctx.fillStyle = '#12161a'; ctx.fillRect(bx - 4, by, bw + 8, 4);   // nozzle mouth
  ctx.fillStyle = '#3a424a'; ctx.fillRect(bx - 8, st.h - 8, bw + 16, 6); // base collar
}

function flameTongue(ctx, cx, baseY, halfW, height, sway, color, glowBlur) {
  ctx.beginPath();
  ctx.moveTo(cx - halfW, baseY);
  ctx.quadraticCurveTo(cx - halfW, baseY - height * 0.55, cx + sway, baseY - height);
  ctx.quadraticCurveTo(cx + halfW, baseY - height * 0.55, cx + halfW, baseY);
  ctx.quadraticCurveTo(cx, baseY + 5, cx - halfW, baseY);
  ctx.closePath();
  ctx.shadowColor = color; ctx.shadowBlur = glowBlur;
  ctx.fillStyle = color; ctx.fill();
  ctx.shadowBlur = 0;
}

function finish() {
  const st = _st;
  st.over = true;
  window.AudioEngine?.stopLoop?.(BURNER_LOOP.id);
  const score = Math.max(0, Math.min(100, Math.round((st.inBand / st.dur) * 100)));
  const resEl = _overlay?.querySelector('#sl-result');
  if (resEl) {
    const cls = score >= 75 ? 'sl-win' : score >= 45 ? 'sl-mid' : 'sl-lose';
    const verdict = score >= 75 ? 'CLEAN COOK' : score >= 45 ? 'PASSABLE' : 'MESSY';
    resEl.innerHTML = `<span class="${cls}">${verdict} — ${score}% STABLE</span>`;
  }
  const cb = _opts?.onResult;
  sfx(score >= 60 ? 'synth-good' : 'synth-bad');
  setTimeout(() => { close(); if (cb) cb({ score }); }, 950);
}

function close() {
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  if (_keyDown) { window.removeEventListener('keydown', _keyDown); _keyDown = null; }
  if (_keyUp) { window.removeEventListener('keyup', _keyUp); _keyUp = null; }
  window.AudioEngine?.stopLoop?.(BURNER_LOOP.id);
  if (_overlay) { _overlay.remove(); _overlay = null; }
  _st = null;
}

// Weather FX overlay — a decorative particle/haze layer pinned over the top pane
// (#area-pane) that animates the current *outdoor* weather for immersion. Purely
// cosmetic: pointer-events:none, driven entirely by the weather state that already
// reaches the client (environment.js feeds it a descriptor). Toggleable in Settings
// and auto-off when Motion is off or the player is indoors.
//
// The canvas is position:fixed and each frame re-synced to #area-pane's on-screen
// rectangle, so it tracks pane resizes/scroll/layout without ever scrolling away
// with the room text or blocking clicks.

let canvas = null;
let ctx = null;
let running = false;
let enabled = false;             // Settings gate (weatherFx on + motion on); default off until settings apply
let suppressed = false;          // hard override — on while the flight cockpit owns the pane (it draws its own windshield weather); prevents the outdoor overlay flashing over the cockpit on embark

// Current *target* effect descriptor: { effect, intensity, windKph }. `effect` is
// one of 'rain' | 'snow' | 'ash' | 'fog' | 'wind' | 'none'; intensity is 0..1.
let cur = { effect: 'none', intensity: 0, windKph: 0 };

// Rendered state, eased toward the target so weather ramps in/out instead of
// snapping. `active` is the effect actually being drawn; while it differs from
// `cur.effect` we're retiring the old one (presence → 0) before switching.
//   presence     0..1 fade factor — 1 = fully present, 0 = gone. Drives the
//                appear/retire fade all the way down to zero particles.
//   dispIntensity eased copy of cur.intensity, so a rain level change (light↔
//                heavy) ramps smoothly rather than jumping the particle count.
let active = 'none';
let presence = 0;
let dispIntensity = 0;
const PRES_RATE = 0.5;   // presence units/sec → ~2s to fully fade in or out
const INT_RATE = 0.6;    // intensity units/sec → smooth ramp between levels

function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return v;
}

// Ease presence/intensity and, once a retiring effect has fully faded, swap to
// the new target effect and begin fading it in. Called each frame from draw().
function updateTransition(dt) {
  const retiring = active !== cur.effect;
  presence = approach(presence, (retiring || active === 'none') ? 0 : 1, dt * PRES_RATE);
  if (!retiring) dispIntensity = approach(dispIntensity, cur.intensity, dt * INT_RATE);
  if (retiring && presence <= 0.001) {
    active = cur.effect;
    dispIntensity = 0;      // ramp the incoming effect up from nothing
    reseed();
  }
}

// Named "hero" weather event overlay, composited ON TOP of the base effect:
// ion_storm (green tint + lightning flashes) / acid_rain (caustic yellow-green
// wash). Driven by the `weather_event` WS message. `phase` scales intensity.
let eventFx = { type: null, phase: null };
let flashA = 0;   // current ion-storm flash alpha, decays each frame
let arcs = [];    // live ion-storm discharges — { pts, a }
let etches = [];  // live acid-rain etch marks — { x, y, r, a }
let etchTimer = 0;

// Admin fireworks: a soft, slowly hue-drifting colour wash over the top of the pane for the
// show's duration — the glow of the display lighting up the sky. On its own channel (not
// eventFx) so it never clobbers a genuinely active weather hero event. The discrete per-burst
// flashes are the separate `fireworks_flash` overlay in dispatch.js; this is the ambient glow.
let fireworksGlow = false;
let glowT = 0;

// Real particle explosions for bursts going off within a couple tiles — a shell's worth of
// sparks flung out from a point high in the pane, arcing down under gravity and fading. A shell
// first *climbs* (see `shells`) and detonates at its apex. Driven by the `fireworks_launch` WS
// message (via launchFirework) only when the launch is close enough that a flat sky-flash would
// undersell it. Each `bursts` entry is one detonation; `shells` are the rising trails. Both additive.
let bursts = [];
let shells = [];

let particles = [];
let fogBlobs = [];
let lastT = 0;
let paneRect = { left: 0, top: 0, width: 0, height: 0 };

// Rain stroke colour, swapped by theme so drops stay legible on both dark and
// light backgrounds (pale blue on dark, deep blue on light). Refreshed whenever
// the loop (re)starts or reseeds, which covers storm-start and effect changes.
let rainRGB = '178,203,235';
function bgIsLight() {
  const c = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 140;
}
function refreshThemeColors() {
  rainRGB = bgIsLight() ? '54,88,132' : '178,203,235';
}

function ensureCanvas() {
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.id = 'weather-fx-canvas';
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  return canvas;
}

// Sync the canvas to the area-pane's current on-screen box. Returns false when
// the pane is missing or has no size (collapsed on mobile) so the loop idles.
function syncRect() {
  const pane = document.getElementById('area-pane');
  if (!pane) return false;
  const r = pane.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const changed = r.left !== paneRect.left || r.top !== paneRect.top ||
    r.width !== paneRect.width || r.height !== paneRect.height;
  paneRect = { left: r.left, top: r.top, width: r.width, height: r.height };
  if (changed) {
    canvas.style.left = r.left + 'px';
    canvas.style.top = r.top + 'px';
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  return true;
}

// Target particle count for the active effect, scaled by pane area so a big
// desktop pane isn't sparse and a small mobile one isn't a blizzard.
function targetCount() {
  const area = paneRect.width * paneRect.height;
  const density = area / 9000; // ~1 particle per 9k px² at full intensity
  // Uses the eased dispIntensity so a level change ramps the count, and the
  // whole thing is scaled by `presence` so an appearing/retiring effect grows
  // from and shrinks to zero particles instead of popping in/out.
  // Rain keeps a healthy floor (0.9·density) so even a light drizzle reads as
  // rain, then scales up with intensity — always visible while fully present.
  let base = 0;
  if (active === 'rain') base = density * (0.9 + 1.6 * dispIntensity);
  else if (active === 'snow') base = density * (0.2 + 0.5 * dispIntensity);
  else if (active === 'ash')  base = density * (0.15 + 0.35 * dispIntensity);
  else if (active === 'wind') base = density * (0.03 + 0.05 * dispIntensity);
  return Math.round(base * presence);
}

function rand(a, b) { return a + Math.random() * (b - a); }

function spawnParticle(fromTop) {
  const w = paneRect.width, h = paneRect.height;
  const wind = cur.windKph / 60; // 0..~1.5
  if (active === 'rain') {
    return {
      x: rand(-0.1 * w, w), y: fromTop ? rand(-h, 0) : rand(0, h),
      len: rand(10, 18) * (0.7 + dispIntensity), vy: rand(600, 900) * (0.6 + dispIntensity),
      vx: (120 + 300 * wind), a: rand(0.45, 0.8),
    };
  }
  if (active === 'snow') {
    const r = rand(1.2, 3.2);
    return {
      x: rand(0, w), y: fromTop ? rand(-h, 0) : rand(0, h),
      r, vy: rand(25, 60) * (0.7 + dispIntensity), vx: 30 * wind,
      sway: rand(0.5, 1.5), phase: rand(0, Math.PI * 2), a: rand(0.5, 0.9),
    };
  }
  if (active === 'wind') {
    // Long, near-horizontal gust streaks blowing across the pane.
    return {
      x: rand(-0.3 * w, w * 0.2), y: rand(0, h),
      len: rand(30, 80) * (0.6 + dispIntensity), vx: rand(500, 850) * (0.6 + dispIntensity),
      vy: rand(-20, 20), a: rand(0.06, 0.16),
    };
  }
  // ash
  const r = rand(0.8, 2.4);
  return {
    x: rand(0, w), y: fromTop ? rand(-h, 0) : rand(0, h),
    r, vy: rand(18, 45) * (0.7 + dispIntensity), vx: 20 * wind,
    sway: rand(0.3, 1.2), phase: rand(0, Math.PI * 2), a: rand(0.35, 0.7),
    flick: rand(0, Math.PI * 2),
  };
}

function reseed() {
  refreshThemeColors();
  particles = [];
  fogBlobs = [];
  if (active === 'fog') {
    const n = Math.round(3 + 3 * cur.intensity);
    for (let i = 0; i < n; i++) {
      fogBlobs.push({
        x: rand(0, paneRect.width), y: rand(0, paneRect.height),
        r: rand(paneRect.width * 0.25, paneRect.width * 0.6),
        vx: rand(-8, 8) + cur.windKph * 0.4, a: rand(0.04, 0.10),
      });
    }
    return;
  }
  const n = targetCount();
  for (let i = 0; i < n; i++) particles.push(spawnParticle(false));
}

function drawBase(dt, w, h) {
  if (active === 'fog') {
    if (!fogBlobs.length) reseed();  // pane may have been collapsed at reseed time
    for (const b of fogBlobs) {
      b.x += b.vx * dt;
      if (b.x - b.r > w) b.x = -b.r;
      if (b.x + b.r < 0) b.x = w + b.r;
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, `rgba(200,205,210,${b.a * presence})`);
      g.addColorStop(1, 'rgba(200,205,210,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }

  // Keep the pool sized to the current target (intensity can change live).
  const want = targetCount();
  while (particles.length < want) particles.push(spawnParticle(true));
  if (particles.length > want) particles.length = want;

  if (active === 'rain') {
    ctx.strokeStyle = `rgba(${rainRGB},1)`;   // per-particle alpha × presence is the attenuation
    ctx.lineWidth = 1.4;
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y > h || p.x > w + 20) { Object.assign(p, spawnParticle(true)); continue; }
      const dx = p.vx / p.vy * p.len, dy = p.len;
      ctx.globalAlpha = p.a * presence;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - dx, p.y - dy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return;
  }

  if (active === 'wind') {
    ctx.strokeStyle = 'rgba(210,215,220,0.7)';
    ctx.lineWidth = 1;
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x - p.len > w) { Object.assign(p, spawnParticle(false)); continue; }
      ctx.globalAlpha = p.a * presence;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.len, p.y - (p.vy / p.vx) * p.len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return;
  }

  // snow + ash share a drifting-flake path, differing only in colour/flicker.
  for (const p of particles) {
    p.phase += p.sway * dt;
    p.x += (p.vx + Math.sin(p.phase) * (12 + 8 * (p.sway))) * dt;
    p.y += p.vy * dt;
    if (p.y > h + 4) { Object.assign(p, spawnParticle(false), { y: -4, x: rand(0, w) }); continue; }
    if (p.x > w + 4) p.x = -4; else if (p.x < -4) p.x = w + 4;
    let alpha = p.a;
    if (active === 'ash') { p.flick += dt * 4; alpha = p.a * (0.7 + 0.3 * Math.sin(p.flick)); }
    alpha *= presence;
    ctx.fillStyle = active === 'snow'
      ? `rgba(235,240,248,${alpha})`
      : `rgba(120,116,110,${alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// A named-event colour overlay drawn over the base precip effect. Phase scales it:
// full at peak, softer in approach/passing. Ion storm adds intermittent flashes.
function drawEventOverlay(dt, w, h) {
  const m = eventFx.phase === 'peak' ? 1 : 0.55;
  if (eventFx.type === 'acid_rain') {
    ctx.fillStyle = `rgba(150,200,40,${0.05 + 0.06 * m})`;   // caustic yellow-green wash
    ctx.fillRect(0, 0, w, h);
    // Etch marks: short-lived bright pits where a drop has just landed and started
    // eating something. The wash alone reads as a colour grade; these read as the
    // rain doing damage, which is the whole point of the event.
    etchTimer -= dt;
    if (etchTimer <= 0) {
      etchTimer = 0.05 / m;
      etches.push({ x: rand(0, w), y: rand(0, h), r: rand(1, 2.6), a: 0.55 * m });
      if (etches.length > 70) etches.shift();
    }
    for (let i = etches.length - 1; i >= 0; i--) {
      const e = etches[i];
      e.a -= dt * 1.4;
      if (e.a <= 0) { etches.splice(i, 1); continue; }
      ctx.fillStyle = `rgba(220,255,120,${e.a})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  if (eventFx.type === 'rainbow' || eventFx.type === 'triple_rainbow') {
    drawRainbow(w, h, m, eventFx.type === 'triple_rainbow' ? 3 : 1);
    return;
  }
  if (eventFx.type === 'ion_storm') {
    ctx.fillStyle = `rgba(80,255,140,${0.04 + 0.06 * m})`;   // sickly green tint
    ctx.fillRect(0, 0, w, h);
    // Lightning: decay any live flash, randomly ignite a new one (rate/brightness
    // scale with phase). dt-scaled so frequency is frame-rate independent.
    flashA = Math.max(0, flashA - dt * 4);
    const flashesPerSec = eventFx.phase === 'peak' ? 0.7 : 0.28;
    if (Math.random() < flashesPerSec * dt) { flashA = 0.3 + 0.4 * m; spawnArc(w, h, m); }
    if (flashA > 0.01) { ctx.fillStyle = `rgba(215,255,230,${flashA})`; ctx.fillRect(0, 0, w, h); }
    drawArcs(dt);
  }
}

// ── Rainbows ────────────────────────────────────────────────────────────────
// Arcs struck through the pane from a centre well below it, so what shows is the
// top of something much larger than the window — which is what a rainbow looks
// like from a street. Bands are drawn outer-first at low alpha and composited
// with `lighter`, so they read as light rather than as paint.
//
// `count` is 1 or 3. The second arc is the reflection and so its bands run in
// REVERSE (red inside, violet outside) — the detail that makes a double read as
// a real one rather than as the same picture drawn twice; the third is fainter
// again. Everything else about it is the same code.
const BOW_BANDS = [
  [255, 70, 84], [255, 150, 60], [255, 226, 96],
  [110, 230, 130], [90, 200, 255], [120, 130, 255], [205, 110, 255],
];

function drawRainbow(w, h, m, count) {
  const cx = w * 0.5;
  const cy = h * 1.35;                 // centre below the pane: we see the crown only
  const base = h * 1.05;               // primary arc radius
  const bandW = Math.max(2, h * 0.022);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'butt';
  for (let arc = 0; arc < count; arc++) {
    // Each successive arc sits further out, is dimmer, and (from the second on)
    // has its colours reversed.
    const r0 = base * (1 + arc * 0.17);
    const alpha = (0.16 * m) / (1 + arc * 1.3);
    if (alpha < 0.004) continue;
    for (let i = 0; i < BOW_BANDS.length; i++) {
      const idx = arc % 2 === 1 ? BOW_BANDS.length - 1 - i : i;
      const [r, g, b] = BOW_BANDS[idx];
      ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.lineWidth = bandW;
      ctx.beginPath();
      ctx.arc(cx, cy, r0 + i * bandW, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
    }
  }
  // A triple is meant to be the splendid one, so it also warms the whole pane a
  // little. A single arc does not — it should feel like weather, not a filter.
  if (count >= 3) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(255,246,230,${0.035 * m})`;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

// Ion arcs: a jagged discharge crawling down the pane, drawn on top of the flash.
// A full-pane white fill says "something bright happened somewhere"; a visible
// bolt says the air itself is conducting, which is what an ion storm IS.
function spawnArc(w, h, m) {
  const pts = [];
  let x = rand(w * 0.15, w * 0.85);
  let y = -4;
  const step = h / 9;
  while (y < h) {
    pts.push({ x, y });
    y += step;
    x += rand(-28, 28);
  }
  arcs.push({ pts, a: 0.5 + 0.4 * m });
}

function drawArcs(dt) {
  for (let i = arcs.length - 1; i >= 0; i--) {
    const arc = arcs[i];
    arc.a -= dt * 3.2;
    if (arc.a <= 0) { arcs.splice(i, 1); continue; }
    ctx.strokeStyle = `rgba(200,255,225,${arc.a})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(arc.pts[0].x, arc.pts[0].y);
    for (const p of arc.pts) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
}

function draw(dt) {
  const w = paneRect.width, h = paneRect.height;
  updateTransition(dt);
  ctx.clearRect(0, 0, w, h);
  drawBase(dt, w, h);
  if (eventFx.type) drawEventOverlay(dt, w, h);
  if (fireworksGlow) drawFireworksGlow(dt, w, h);
  if (shells.length) drawShells(dt, w, h);
  if (bursts.length) drawBursts(dt, w, h);
}

// Seed a climbing shell: a hot ember streaking up from the bottom of the pane to a burst point
// high in the sky over `leadMs`, laying a fading trail behind it. When it reaches the apex it
// detonates (spawnBurst) right there. The whistle SFX is tuned to the same lead, so its pitch
// peaks as the trail tops out. Trail/head are white-gold (the colour is revealed by the burst).
function spawnShell(rgb, leadMs) {
  const w = paneRect.width, h = paneRect.height;
  const tx = rand(w * 0.2, w * 0.8);
  const ty = rand(h * 0.1, h * 0.4);
  const sx = tx + rand(-w * 0.05, w * 0.05);   // launched with a slight lean off vertical
  shells.push({ sx, sy: h + 6, tx, ty, x: sx, y: h + 6, rgb, dur: Math.max(0.25, (leadMs || 900) / 1000), t: 0, trail: [] });
}

// Advance + draw every climbing shell. Additive blend for the glowing trail; the shell decelerates
// as it rises (easeOut) so it visibly slows near the apex before bursting. A shell that reaches its
// apex spawns its burst and is culled.
function drawShells(dt, w, h) {
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  for (const s of shells) {
    s.t += dt;
    const p = Math.min(1, s.t / s.dur);
    const e = 1 - (1 - p) * (1 - p);   // easeOut — fast off the pad, slowing toward the apex
    s.x = s.sx + (s.tx - s.sx) * e;
    s.y = s.sy + (s.ty - s.sy) * e;
    s.trail.push({ x: s.x, y: s.y, a: 1 });
    if (s.trail.length > 16) s.trail.shift();
    for (const q of s.trail) q.a -= dt * 2.4;   // trail fades quickly behind the ember
    for (let i = 1; i < s.trail.length; i++) {
      const q0 = s.trail[i - 1], q1 = s.trail[i];
      const a = Math.max(0, q1.a);
      if (a <= 0) continue;
      ctx.strokeStyle = `rgba(255,238,190,${a * 0.6})`;
      ctx.lineWidth = 1.4 * a + 0.3;
      ctx.beginPath(); ctx.moveTo(q0.x, q0.y); ctx.lineTo(q1.x, q1.y); ctx.stroke();
    }
    const flick = 0.7 + 0.3 * Math.sin(s.t * 45);   // the ember sputters as it climbs
    ctx.fillStyle = `rgba(255,250,232,${flick})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = prev;
  for (const s of shells) if (s.t >= s.dur) spawnBurst(s.rgb, s.tx, s.ty);
  shells = shells.filter(s => s.t < s.dur);
}

// Seed one detonation: a spray of sparks radiating from a point high in the pane (the sky),
// each with an outward velocity, gravity, drag, and a lifetime. rgb tints them, with a little
// per-spark variance so the shell shimmers rather than reading as one flat colour. cx/cy default
// to a random sky point but are supplied by a climbing shell so the burst lands at its apex.
function spawnBurst(rgb, cx, cy) {
  const w = paneRect.width, h = paneRect.height;
  const [br, bg, bb] = Array.isArray(rgb) ? rgb : [255, 220, 120];
  if (cx == null) cx = rand(w * 0.2, w * 0.8);
  if (cy == null) cy = rand(h * 0.1, h * 0.4);
  const speed = rand(120, 205) * (0.75 + Math.min(1.1, (w * h) / 800000));  // scale reach with pane size
  const n = 62 + Math.floor(Math.random() * 42);
  const sparks = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + rand(-0.08, 0.08);
    const sp = speed * rand(0.4, 1);
    const v = rand(0.3, 0.9);   // per-spark colour variance toward white
    sparks.push({
      x: cx, y: cy,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      life: rand(1.2, 2), max: 2,
      r: [Math.min(255, br + (255 - br) * (1 - v)), Math.min(255, bg + (255 - bg) * (1 - v)), Math.min(255, bb + (255 - bb) * (1 - v))],
    });
  }
  bursts.push({ sparks });
}

// Advance + draw every live detonation. Additive ('lighter') blend so overlapping sparks glow;
// each spark trails a short line back along its velocity. Dead sparks (life ≤ 0) are culled and
// an emptied burst is dropped so the loop can idle once the last one fades.
function drawBursts(dt, w, h) {
  const GRAV = 90, DRAG = 0.86;
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 2;
  for (const b of bursts) {
    for (const s of b.sparks) {
      s.life -= dt;
      if (s.life <= 0) continue;
      const drag = Math.pow(DRAG, dt);   // frame-rate-independent drag
      s.vx *= drag;
      s.vy = s.vy * drag + GRAV * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      const a = Math.max(0, s.life / s.max);
      const [r, g, bl] = s.r;
      ctx.strokeStyle = `rgba(${r|0},${g|0},${bl|0},${a * 0.7})`;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * dt * 3, s.y - s.vy * dt * 3);
      ctx.stroke();
      ctx.fillStyle = `rgba(${r|0},${g|0},${bl|0},${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
    b.sparks = b.sparks.filter(s => s.life > 0);
  }
  bursts = bursts.filter(b => b.sparks.length);
  ctx.globalCompositeOperation = prev;
}

// A gentle colour wash across the upper half of the pane, its hue slowly drifting and its
// alpha breathing — the reflected glow of fireworks lighting the sky. Additive-soft, kept
// faint so it reads as sky-glow rather than a tint over the whole room.
function drawFireworksGlow(dt, w, h) {
  glowT += dt;
  const hue = (glowT * 45) % 360;
  const a = 0.05 + 0.035 * (0.5 + 0.5 * Math.sin(glowT * 1.7));
  const grad = ctx.createLinearGradient(0, 0, 0, h * 0.55);
  grad.addColorStop(0, `hsla(${hue},90%,62%,${a})`);
  grad.addColorStop(1, `hsla(${hue},90%,62%,0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h * 0.55);
}

function frame(t) {
  if (!running) return;
  const dt = lastT ? Math.min((t - lastT) / 1000, 0.05) : 0;
  lastT = t;
  if (syncRect()) draw(dt);
  if (!shouldRun()) { stopLoop(); return; }   // effect fully faded out → idle
  requestAnimationFrame(frame);
}

// Keep running while anything is still on screen — including an effect mid-fade
// (active/presence) after the target has already gone to 'none'.
function shouldRun() {
  const busy = cur.effect !== 'none' || active !== 'none' || presence > 0.001 || !!eventFx.type || fireworksGlow || bursts.length > 0 || shells.length > 0;
  return enabled && !suppressed && busy && !document.hidden;
}

function startLoop() {
  if (running || !shouldRun()) return;
  ensureCanvas();
  canvas.style.display = '';
  running = true;
  lastT = 0;
  // Fresh start: begin from nothing and let updateTransition fade the effect in.
  active = cur.effect;
  presence = 0;
  dispIntensity = 0;
  if (syncRect()) reseed();
  requestAnimationFrame(frame);
}

function stopLoop() {
  running = false;
  if (canvas) { ctx?.clearRect(0, 0, paneRect.width, paneRect.height); canvas.style.display = 'none'; }
}

// Public: update the active weather effect. Called by environment.js whenever the
// local weather or indoor/outdoor state changes.
export function setWeatherFx({ effect, intensity, windKph }) {
  cur = { effect: effect || 'none', intensity: Math.max(0, Math.min(1, intensity || 0)), windKph: windKph || 0 };
  // Don't touch `active`/particles here — updateTransition eases toward the new
  // target every frame (ramping the level, or fading out and swapping effects).
  // While disabled we still stop; otherwise ensure the loop is turning so the
  // fade actually animates even when the new target is 'none'.
  if (!enabled) { stopLoop(); return; }
  startLoop();
}

// Public: set/clear the active named-event overlay (ion_storm | acid_rain | null).
// Driven by the `weather_event` WS message; independent of the base precip effect,
// so an ion storm (no precip) still renders its overlay.
export function setWeatherEventFx(type, phase) {
  eventFx = { type: type || null, phase: phase || null };
  if (type) flashA = 0;
  // Never carry one event's live geometry into the next (or into no event at all).
  arcs = []; etches = []; etchTimer = 0;
  if (!shouldRun()) { stopLoop(); return; }
  startLoop();
}

// Public: turn the admin-fireworks sky glow on/off. Driven by the `fireworks_sky` WS message
// at show start/end. Suppressed automatically while the cockpit owns the pane (via the
// existing `suppressed` gate) — airborne pilots get the real 3D bursts instead.
export function setFireworksGlow(on) {
  fireworksGlow = !!on;
  if (on) glowT = 0;
  if (!shouldRun()) { stopLoop(); return; }
  startLoop();
}

// Public: launch a climbing shell (trail rising to a sky apex, then a particle burst) for a
// nearby firework. Driven by the `fireworks_launch` WS message when the launch is within a couple
// tiles; `leadMs` matches the whistle so the trail tops out as the pitch peaks. Gated by the same
// enabled/suppressed rules as the rest of the overlay (airborne pilots get the 3D burst instead).
export function launchFirework(rgb, leadMs) {
  if (!enabled || suppressed) return;
  ensureCanvas();
  if (!syncRect()) return;     // pane collapsed (mobile) — nothing to draw on
  spawnShell(rgb, leadMs);
  startLoop();
}

// Public: Settings gate — weatherFx toggle AND motion setting combine here.
export function setWeatherFxEnabled(on) {
  enabled = !!on;
  if (!enabled) stopLoop();
  else { refreshThemeColors(); startLoop(); }  // refresh even if already running (theme switch)
}

// Public: other panels (e.g. the cockpit windshield) that draw their own weather
// flourishes gate on this so every visual effect — lightning included — lives
// under the one WeatherFX toggle instead of having its own always-on switch.
export function isWeatherFxEnabled() {
  return enabled;
}

// Public: hard-suppress the outdoor overlay while the flight cockpit owns the pane
// (it renders its own windshield weather). Stops it immediately on embark so rain never
// flashes over the cockpit, and lets it resume for the room view on exit.
export function suppressWeatherFx(on) {
  suppressed = !!on;
  if (suppressed) stopLoop();
  else startLoop();
}

export function initWeatherFx() {
  document.addEventListener('visibilitychange', () => {
    if (shouldRun()) startLoop(); else stopLoop();
  });
  // The rAF loop already re-syncs the rect each frame; nothing else to wire.
}

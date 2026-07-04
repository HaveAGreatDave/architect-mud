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
    return;
  }
  if (eventFx.type === 'ion_storm') {
    ctx.fillStyle = `rgba(80,255,140,${0.04 + 0.06 * m})`;   // sickly green tint
    ctx.fillRect(0, 0, w, h);
    // Lightning: decay any live flash, randomly ignite a new one (rate/brightness
    // scale with phase). dt-scaled so frequency is frame-rate independent.
    flashA = Math.max(0, flashA - dt * 4);
    const flashesPerSec = eventFx.phase === 'peak' ? 0.7 : 0.28;
    if (Math.random() < flashesPerSec * dt) flashA = 0.3 + 0.4 * m;
    if (flashA > 0.01) { ctx.fillStyle = `rgba(215,255,230,${flashA})`; ctx.fillRect(0, 0, w, h); }
  }
}

function draw(dt) {
  const w = paneRect.width, h = paneRect.height;
  updateTransition(dt);
  ctx.clearRect(0, 0, w, h);
  drawBase(dt, w, h);
  if (eventFx.type) drawEventOverlay(dt, w, h);
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
  const busy = cur.effect !== 'none' || active !== 'none' || presence > 0.001 || !!eventFx.type;
  return enabled && busy && !document.hidden;
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
  if (!shouldRun()) { stopLoop(); return; }
  startLoop();
}

// Public: Settings gate — weatherFx toggle AND motion setting combine here.
export function setWeatherFxEnabled(on) {
  enabled = !!on;
  if (!enabled) stopLoop();
  else { refreshThemeColors(); startLoop(); }  // refresh even if already running (theme switch)
}

export function initWeatherFx() {
  document.addEventListener('visibilitychange', () => {
    if (shouldRun()) startLoop(); else stopLoop();
  });
  // The rAF loop already re-syncs the rect each frame; nothing else to wire.
}

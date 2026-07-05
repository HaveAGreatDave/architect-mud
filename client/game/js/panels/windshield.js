// WINDSHIELD — the out-the-front-window forward view.
//
// A canvas scene shared by the pilot cockpit, the passenger cabin, and the
// takeoff/landing/VTOL decks. It renders a first-person view through the canopy:
// a time-of-day sky, drifting clouds, a perspective ground plane that scrolls
// with your speed, the zones/obstacles ahead of you rising off that plane, a
// runway (or landing pad) whose size reflects your height above the ground, plus
// weather and speed flourishes and a static canopy frame. It is display-only —
// the numbers come from the same server push (or, in the decks, the minigame's
// own physics loop).
//
// paintWindshield(id, view) where view = {
//   pitch,      // deg, + = nose up
//   bank,       // deg, + = right bank
//   height,     // 0 = on the deck … 1 = high
//   speed,      // 0..1 airspeed fraction
//   hour,       // 0..23 in-game hour (sky palette)
//   weather,    // 'rain'|'storm'|'snow'|'ash'|'fog'|'cloudy'|'clear'|…
//   heading,    // deg (to orient the map obstacles)
//   map,        // optional server map window (rows[y][x] = {kind}) → obstacles ahead
//   phase,      // 'cruise' | 'takeoff' | 'landing' | 'vtol' | 'ground'
//   drift,      // VTOL only: -1..1 lateral offset off the pad
//   airport,    // ground/takeoff/landing: terrain theme ('city'|'docks'|'yards'|
//               //   'slag'|'wastes'|'default') → the flanking airport scenery
//   side,       // passenger cabin: look out the SIDE (heading turned 90°), scenery
//               //   sliding past the window rather than rushing at you
//   windowClass,// passenger cabin: aircraft class → the window-frame shape cut
//               //   around the view (porthole / cabin pane / armoured port)
// }

const FOV = 58;                 // forward field of view, degrees, for projecting obstacles
const _scenes = new Map();      // id → persistent scene state (scroll, clouds, stars, particles)

function angDelta(a, b) { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; }
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rgb = (c, a) => a == null ? `rgb(${c[0]|0},${c[1]|0},${c[2]|0})` : `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const frac = (n) => { const x = Math.sin((n + 1) * 12.9898) * 43758.5453; return x - Math.floor(x); };   // deterministic 0..1 scatter

// ── Time-of-day sky keyframes (blended by hour) ───────────────────────────────
const SKY = [
  { h: 0,    top: [6, 8, 18],    hor: [20, 22, 40],   g1: [16, 20, 22], g2: [5, 7, 9],   night: 1,   sun: null },
  { h: 5.5,  top: [40, 46, 84],  hor: [206, 122, 84],  g1: [42, 46, 36], g2: [15, 17, 13], night: 0.5, sun: [255, 176, 116] },
  { h: 8,    top: [26, 108, 166],hor: [156, 196, 216], g1: [56, 72, 42], g2: [22, 30, 16], night: 0,   sun: [255, 246, 214] },
  { h: 16,   top: [26, 108, 166],hor: [156, 196, 216], g1: [56, 72, 42], g2: [22, 30, 16], night: 0,   sun: [255, 246, 214] },
  { h: 18.5, top: [44, 48, 92],  hor: [228, 118, 56],  g1: [46, 40, 30], g2: [17, 13, 10], night: 0.5, sun: [255, 146, 84] },
  { h: 21,   top: [6, 8, 18],    hor: [20, 22, 40],   g1: [16, 20, 22], g2: [5, 7, 9],   night: 1,   sun: null },
];
function skyAt(hour) {
  const h = ((hour % 24) + 24) % 24;
  let a = SKY[0], b = SKY[SKY.length - 1];
  for (let i = 0; i < SKY.length - 1; i++) { if (h >= SKY[i].h && h <= SKY[i + 1].h) { a = SKY[i]; b = SKY[i + 1]; break; } }
  const t = b.h === a.h ? 0 : (h - a.h) / (b.h - a.h);
  return {
    top: mix(a.top, b.top, t), hor: mix(a.hor, b.hor, t),
    g1: mix(a.g1, b.g1, t), g2: mix(a.g2, b.g2, t),
    night: lerp(a.night, b.night, t),
    sun: a.sun && b.sun ? mix(a.sun, b.sun, t) : (t < 0.5 ? a.sun : b.sun),
  };
}

// ── Airport terrain themes ────────────────────────────────────────────────────
// The look of the field out the canopy while you're on the deck: ground colour +
// which silhouette flanks the runway (city towers, dock cranes, wasteland rock…).
// `feat` names a drawer in drawAirportFeature; `g1/g2` are the near/far ground.
const AIRPORT = {
  city:    { g1: [60, 64, 72],  g2: [22, 25, 32],  feat: 'building', accent: [150, 180, 210] },
  docks:   { g1: [50, 58, 64],  g2: [18, 24, 30],  feat: 'crane',    accent: [96, 158, 176] },
  yards:   { g1: [62, 56, 46],  g2: [26, 23, 18],  feat: 'gantry',   accent: [186, 150, 88] },
  slag:    { g1: [56, 46, 40],  g2: [22, 16, 13],  feat: 'stack',    accent: [255, 120, 60] },
  wastes:  { g1: [96, 72, 48],  g2: [42, 30, 20],  feat: 'rock',     accent: [188, 138, 92] },
  default: { g1: [52, 58, 52],  g2: [20, 25, 20],  feat: 'hangar',   accent: [150, 172, 150] },
};
const airportCfg = (theme) => AIRPORT[theme] || AIRPORT.default;

function sceneFor(id, W, H) {
  let st = _scenes.get(id);
  if (!st) {
    // Deterministic-ish scatter without Math.random dependence on first frame.
    const rnd = (n) => { let x = Math.sin((n + 1) * 12.9898) * 43758.5453; return x - Math.floor(x); };
    st = { scroll: 0, sideScroll: 0, last: 0, w: 0, h: 0, flash: 0, bolt: null, boltT: 0,
      stars: Array.from({ length: 70 }, (_, i) => ({ x: rnd(i), y: rnd(i + 91) * 0.6, m: 0.4 + rnd(i + 7) * 0.6 })),
      clouds: Array.from({ length: 7 }, (_, i) => ({ x: rnd(i * 3), y: 0.12 + rnd(i * 5) * 0.4, s: 0.5 + rnd(i * 2) * 1.1, sp: 0.3 + rnd(i) * 0.9 })),
      parts: Array.from({ length: 90 }, (_, i) => ({ x: rnd(i * 7), y: rnd(i * 11), v: 0.5 + rnd(i) * 0.8 })),
      drops: Array.from({ length: 30 }, (_, i) => ({ x: rnd(i * 4), y: rnd(i * 6) * 0.9, r: 1.4 + rnd(i * 2) * 3, life: rnd(i), streak: 0 })),
    };
    _scenes.set(id, st);
  }
  return st;
}

// Project the server map window into obstacles in the direction we're looking.
// `look` is the view bearing (heading, or heading±90 for a side window).
function obstaclesFromMap(map, look) {
  if (!map || !map.length) return [];
  const R = (map.length - 1) / 2;
  const out = [];
  for (let ry = 0; ry < map.length; ry++) for (let rx = 0; rx < map[ry].length; rx++) {
    const cell = map[ry][rx]; if (!cell || cell.kind === 'air' || cell.kind === 'craft') continue;
    const dx = rx - R, dy = ry - R; if (dx === 0 && dy === 0) continue;
    const bearing = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;   // 0=N, 90=E
    const rel = angDelta(look || 0, bearing);
    if (Math.abs(rel) > FOV / 2) continue;
    const d = Math.hypot(dx, dy) / (R + 0.5);
    out.push({ ang: rel, dist: clamp(d, 0.04, 1), kind: cell.kind });
  }
  out.sort((a, b) => b.dist - a.dist);   // far first, so near overdraws
  return out;
}

export function ensureWindshieldStyles() {
  if (document.getElementById('cockpit-ws-styles')) return;
  const s = document.createElement('style'); s.id = 'cockpit-ws-styles';
  s.textContent = `
    .ws-wrap { position:relative; width:100%; height:100%; min-height:70px; overflow:hidden;
      border-radius:8px; background:#04070c; box-shadow:inset 0 0 22px rgba(0,0,0,0.75); }
    .ws-canvas { display:block; width:100%; height:100%; }
    .ws-frame { position:absolute; inset:0; pointer-events:none; }
    .ws-frame::before { content:''; position:absolute; inset:0; border-radius:8px;
      box-shadow:inset 0 0 0 3px rgba(20,28,38,0.9), inset 0 0 40px rgba(0,0,0,0.55); }
    /* canopy A-pillars + header rail */
    .ws-frame::after { content:''; position:absolute; inset:0;
      background:
        linear-gradient(180deg, rgba(12,18,26,0.85) 0%, rgba(12,18,26,0) 12%),
        linear-gradient(90deg, rgba(12,18,26,0.7) 0%, rgba(12,18,26,0) 7%, rgba(12,18,26,0) 93%, rgba(12,18,26,0.7) 100%); }
    .ws-label { position:absolute; top:5px; left:9px; font:9px/1 monospace; letter-spacing:2px;
      color:rgba(143,208,255,0.55); pointer-events:none; }`;
  document.head.appendChild(s);
}

export function windshieldHTML(id, label = 'FWD VIEW') {
  return `<div class="ws-wrap"><canvas id="${id}" class="ws-canvas"></canvas><div class="ws-frame"></div><span class="ws-label">${label}</span></div>`;
}

export function disposeWindshield(id) { _scenes.delete(id); }

export function paintWindshield(id, view) {
  const cv = document.getElementById(id); if (!cv || !cv.getContext) return;
  const cw = cv.clientWidth, ch = cv.clientHeight; if (!cw || !ch) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
  const ctx = cv.getContext('2d');
  const st = sceneFor(id, cw, ch);
  const now = performance.now();
  const dt = Math.min(0.05, st.last ? (now - st.last) / 1000 : 0.016); st.last = now;

  const v = view || {};
  const W = cw, H = ch, speed = clamp(v.speed || 0, 0, 1), height = clamp(v.height || 0, 0, 1);
  const phase = v.phase || 'cruise';
  const wx = (v.weather || 'clear').toLowerCase();
  const sky = skyAt(v.hour == null ? 12 : v.hour);
  const side = !!v.side;                                    // passenger side window (looks 90° off the nose)
  // On the deck (ground/takeoff/landing) we paint a real, terrain-themed airport.
  const onDeck = phase === 'ground' || phase === 'takeoff' || phase === 'landing';
  const airport = onDeck ? airportCfg(v.airport) : null;
  st.scroll = (st.scroll + speed * dt * (1.1 - height * 0.4) * 2.4) % 1;
  st.sideScroll = (st.sideScroll + speed * dt * 0.9) % 1;   // lateral drift for the side window

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // Horizon. On the deck it tracks how much field is in view: pull the nose up (or
  // climb away) and the airport sinks off the bottom until the view "levels out"
  // into open sky. Airborne, pitch/altitude nudge it as before.
  const reveal = onDeck ? clamp(1 - Math.max(0, v.pitch || 0) / 26 - height * 0.95, 0, 1) : 0;
  const horizonY = onDeck
    ? lerp(H * 1.08, H * 0.42, reveal)
    : clamp(H * 0.46 - (v.pitch || 0) * H * 0.011 + (height - 0.2) * H * 0.09, H * 0.14, H * 0.84);
  const bankRad = (v.bank || 0) * Math.PI / 180;
  // Ground palette: airport terrain colours on the deck, else the sky's ground band.
  const gTop = airport ? mix(airport.g1, [0, 0, 0], sky.night * 0.45) : sky.g1;
  const gBot = airport ? mix(airport.g2, [0, 0, 0], sky.night * 0.5) : sky.g2;

  // World (banks with the aircraft) — draw oversized so rotation never reveals edges.
  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.rotate(-bankRad); ctx.translate(-W / 2, -H / 2);
  const OX = W, ex = W * 3;   // over-extents

  // Sky.
  let g = ctx.createLinearGradient(0, -H, 0, horizonY);
  g.addColorStop(0, rgb(sky.top)); g.addColorStop(1, rgb(sky.hor));
  ctx.fillStyle = g; ctx.fillRect(-OX, -H, ex, horizonY + H);

  // Stars (night).
  if (sky.night > 0.15) {
    ctx.fillStyle = rgb([230, 236, 255], sky.night);
    for (const s2 of st.stars) { const sy = s2.y * horizonY; if (sy > horizonY) continue; const tw = 0.5 + 0.5 * Math.sin(now * 0.002 * s2.m + s2.x * 30); ctx.globalAlpha = sky.night * s2.m * tw; ctx.fillRect(s2.x * W, sy, 1.4, 1.4); }
    ctx.globalAlpha = 1;
  }
  // Sun / moon.
  if (sky.sun || sky.night > 0.4) {
    const sunX = clamp((( (v.hour == null ? 12 : v.hour) - 6) / 12), 0.08, 0.92) * W;
    const sunY = horizonY * (0.30 + 0.35 * Math.sin(clamp(((v.hour == null ? 12 : v.hour) - 6) / 12, 0, 1) * Math.PI));
    const disc = sky.sun || [220, 226, 236];
    const rg = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, 46);
    rg.addColorStop(0, rgb(disc, 0.95)); rg.addColorStop(0.4, rgb(disc, 0.5)); rg.addColorStop(1, rgb(disc, 0));
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(sunX, sunY, 46, 0, 7); ctx.fill();
    ctx.fillStyle = rgb(disc, 0.95); ctx.beginPath(); ctx.arc(sunX, sunY, sky.night > 0.4 ? 12 : 15, 0, 7); ctx.fill();
  }
  // Clouds — soft, layered puffs (a lit crown over a shaded, feathered base) that
  // drift with parallax. Radial gradients feather the edges so they read as vapour
  // rather than the flat hard discs they used to be. Greyer/heavier in bad weather.
  const cloudy = wx === 'cloudy' || wx === 'rain' || wx === 'storm' || wx === 'snow' || wx === 'fog';
  const cloudAlpha = (wx === 'clear' ? 0.42 : cloudy ? 0.64 : 0.5) * (1 - sky.night * 0.55);
  const baseTint = cloudy ? [148, 156, 166] : mix([245, 248, 252], sky.hor, 0.22);
  const litTint = cloudy ? [190, 196, 204] : mix([255, 255, 255], sky.sun || [255, 250, 240], 0.28);
  for (const c of st.clouds) {
    c.x = (c.x + (0.003 + speed * 0.04) * c.sp * dt * 6) % 1.28;
    const cy = c.y * horizonY * 0.8, cx = (c.x - 0.14) * W, cs = c.s * (W * 0.07);
    const a = cloudAlpha * clamp(c.s, 0.4, 1);
    // grounding shadow first, then the feathered body
    ctx.fillStyle = rgb(mix(baseTint, [36, 40, 50], 0.55), a * 0.22);
    ctx.beginPath(); ctx.ellipse(cx + cs * 0.2, cy + cs * 0.52, cs * 1.7, cs * 0.26, 0, 0, 7); ctx.fill();
    for (const [ox, oy, rr] of [[-cs * 1.1, 7, cs * 0.92], [-cs * 0.25, 1, cs * 1.28], [cs * 0.75, 6, cs * 0.9], [cs * 0.3, -9, cs * 0.78], [cs * 1.55, 10, cs * 0.6]]) {
      const rg = ctx.createRadialGradient(cx + ox, cy + oy - rr * 0.35, rr * 0.15, cx + ox, cy + oy, rr);
      rg.addColorStop(0, rgb(litTint, a)); rg.addColorStop(0.5, rgb(baseTint, a * 0.9)); rg.addColorStop(1, rgb(baseTint, 0));
      ctx.fillStyle = rg; ctx.beginPath(); ctx.ellipse(cx + ox, cy + oy, rr, rr * 0.64, 0, 0, 7); ctx.fill();
    }
  }

  // Ground.
  g = ctx.createLinearGradient(0, horizonY, 0, H + (H - horizonY));
  g.addColorStop(0, rgb(gTop)); g.addColorStop(1, rgb(gBot));
  ctx.fillStyle = g; ctx.fillRect(-OX, horizonY, ex, (H - horizonY) + H);
  // atmospheric haze band at the horizon
  const haze = ctx.createLinearGradient(0, horizonY - 6, 0, horizonY + 26);
  haze.addColorStop(0, rgb(sky.hor, 0.55)); haze.addColorStop(1, rgb(sky.hor, 0));
  ctx.fillStyle = haze; ctx.fillRect(-OX, horizonY - 6, ex, 32);

  const vx = W / 2, depthGround = H - horizonY;
  ctx.lineWidth = 1;
  const gridCol = rgb(mix(gTop, [180, 220, 200], 0.5), 0.16 + speed * 0.12);
  ctx.strokeStyle = gridCol;
  if (side && !onDeck) {
    // Side window: the ground rushes past laterally — vertical hatching that
    // scrolls sideways sells forward motion far better than a converging grid.
    for (let k = 0; k < 24; k++) {
      const f = ((k / 24) + st.sideScroll) % 1, x = -OX + f * ex;
      ctx.globalAlpha = 0.09 + speed * 0.2;
      ctx.beginPath(); ctx.moveTo(x, horizonY + depthGround * 0.03); ctx.lineTo(x - 46 - speed * 34, H); ctx.stroke();
    }
    for (let k = 1; k <= 5; k++) { const y = horizonY + depthGround * (k / 5) * (k / 5); ctx.globalAlpha = 0.06; ctx.beginPath(); ctx.moveTo(-OX, y); ctx.lineTo(W + OX, y); ctx.stroke(); }
    ctx.globalAlpha = 1;
  } else if (!onDeck) {
    // Perspective ground grid (forward view).
    const near = 0.10 + height * 0.05;
    for (let k = 1; k <= 12; k++) {
      const d = k - st.scroll;
      const y = horizonY + depthGround * (near / (d * near + near));
      if (y <= horizonY + 1 || y >= H) continue;
      ctx.globalAlpha = clamp((y - horizonY) / depthGround, 0.05, 1);
      ctx.beginPath(); ctx.moveTo(-OX, y); ctx.lineTo(W + OX, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let j = -6; j <= 6; j++) { if (j === 0) continue; const bx = vx + j * (W * 0.16); ctx.beginPath(); ctx.moveTo(vx, horizonY); ctx.lineTo(bx, H); ctx.stroke(); }
  }

  // The airport (themed scenery flanking a runway) on the deck; the pad for VTOL;
  // otherwise the zones/obstacles projected in the direction we're actually looking.
  if (airport && reveal > 0.02) {
    drawAirportScenery(ctx, W, H, horizonY, airport, sky.night, now);
    if (phase === 'takeoff' || phase === 'landing') drawRunway(ctx, W, H, horizonY, height, st.scroll, phase);
    else drawRunway(ctx, W, H, horizonY, 0, st.scroll, 'takeoff');   // parked: the strip laid out full-length
  } else if (phase === 'vtol') {
    drawPad(ctx, W, H, horizonY, height, v.drift || 0);
  } else if (!onDeck) {
    const look = ((v.heading || 0) + (side ? 90 : 0) + 360) % 360;   // side window looks 90° off the nose
    const obs = v.obstacles || obstaclesFromMap(v.map, look);
    for (const o of obs) {
      const sx = vx + (o.ang / (FOV / 2)) * (W * 0.5);
      const gy = horizonY + depthGround * (1 - o.dist);
      const scale = clamp(1 - o.dist, 0.06, 1);
      drawObstacle(ctx, sx, gy, scale, depthGround, o.kind, sky.night, now);
    }
  }

  // Speed streaks (motion rush from the vanishing point) — forward view only.
  if (speed > 0.12 && !side && !onDeck) {
    ctx.strokeStyle = rgb([210, 230, 255], 0.10 + speed * 0.18); ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + st.scroll * 6;
      const len = 14 + speed * 46, r0 = 30 + ((i * 53 + st.scroll * 200) % 120);
      const dx = Math.cos(a), dy = Math.sin(a) * 0.5 - 0.25;
      ctx.beginPath(); ctx.moveTo(vx + dx * r0, horizonY + dy * r0); ctx.lineTo(vx + dx * (r0 + len), horizonY + dy * (r0 + len)); ctx.stroke();
    }
  }

  // Weather particles.
  drawWeather(ctx, W, H, wx, st, dt, speed);
  ctx.restore();   // end banked world

  // Fog wash (unbanked, over everything) — a dense low bank thinning upward.
  if (wx === 'fog') {
    ctx.fillStyle = rgb([150, 158, 168], 0.34); ctx.fillRect(0, 0, W, H);
    const fg = ctx.createLinearGradient(0, horizonY - H * 0.15, 0, H);
    fg.addColorStop(0, 'rgba(176,184,194,0)'); fg.addColorStop(1, 'rgba(176,184,194,0.5)');
    ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);
  }

  // Canopy glass sheen — a soft diagonal reflection that slides a touch with bank.
  const sheen = ctx.createLinearGradient(0, 0, W, H);
  const so = clamp(0.5 + (v.bank || 0) / 120, 0.1, 0.9);
  sheen.addColorStop(clamp(so - 0.18, 0, 1), 'rgba(255,255,255,0)');
  sheen.addColorStop(so, 'rgba(255,255,255,0.06)');
  sheen.addColorStop(clamp(so + 0.18, 0, 1), 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen; ctx.fillRect(0, 0, W, H);
  // corner vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  // On-glass weather (drops that cling to the canopy, lightning) + a WX badge.
  drawGlass(ctx, W, H, wx, st, dt, speed);
  if (!v.windowClass) drawWxBadge(ctx, W, wx, v.wind);
  // Passenger cabin: cut the view into a window shaped to fit the aircraft.
  if (v.windowClass) drawWindowFrame(ctx, W, H, v.windowClass);

  ctx.restore();
}

// The passenger window: fills everything OUTSIDE a class-shaped pane with the dark
// cabin interior, so the scene reads as glimpsed through a real window. Ultralights
// and helis get a small bubble/porthole; a heavy freighter a tall airliner pane; a
// gunship a squat armoured port; props/others a rounded cabin window.
function windowShapeFor(cls, W, H) {
  const cx = W / 2, cy = H / 2;
  switch (cls) {
    case 'ultralight': return { x: cx - W * 0.44, y: cy - H * 0.42, w: W * 0.88, h: H * 0.84, r: Math.min(W, H) * 0.42 };  // near-full bubble canopy
    case 'heli':       return { x: cx - W * 0.42, y: cy - H * 0.40, w: W * 0.84, h: H * 0.80, r: Math.min(W, H) * 0.30 };
    case 'heavy':      return { x: cx - W * 0.16, y: cy - H * 0.34, w: W * 0.32, h: H * 0.68, r: Math.min(W, H) * 0.16 };  // tall cabin pane
    case 'gunship':    return { x: cx - W * 0.20, y: cy - H * 0.18, w: W * 0.40, h: H * 0.36, r: 6 };                      // small armoured port
    default:           return { x: cx - W * 0.30, y: cy - H * 0.32, w: W * 0.60, h: H * 0.64, r: Math.min(W, H) * 0.18 };
  }
}
function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function drawWindowFrame(ctx, W, H, cls) {
  const s = windowShapeFor(cls, W, H);
  // Cabin wall = whole canvas minus the pane (even-odd fill).
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H);
  roundRectPath(ctx, s.x, s.y, s.w, s.h, s.r);
  ctx.fillStyle = '#0c1116'; ctx.fill('evenodd');
  ctx.restore();
  // A little interior modelling on the wall + a bevelled window surround.
  roundRectPath(ctx, s.x - 6, s.y - 6, s.w + 12, s.h + 12, s.r + 6);
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(40,50,60,0.9)'; ctx.stroke();
  roundRectPath(ctx, s.x, s.y, s.w, s.h, s.r);
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(150,180,205,0.28)'; ctx.stroke();
  // Inner glass shading — a soft darkening toward the frame.
  ctx.save(); roundRectPath(ctx, s.x, s.y, s.w, s.h, s.r); ctx.clip();
  const ig = ctx.createRadialGradient(W / 2, H / 2, Math.min(s.w, s.h) * 0.3, W / 2, H / 2, Math.max(s.w, s.h) * 0.7);
  ig.addColorStop(0, 'rgba(0,0,0,0)'); ig.addColorStop(1, 'rgba(6,10,14,0.5)');
  ctx.fillStyle = ig; ctx.fillRect(s.x, s.y, s.w, s.h); ctx.restore();
}

// Water on the windscreen + storm lightning — drawn on the fixed glass, not the
// banked world, so it reads as being *on* the canopy in front of you.
function drawGlass(ctx, W, H, wx, st, dt, speed) {
  if (wx === 'rain' || wx === 'storm') {
    for (const d of st.drops) {
      d.life -= dt * (0.3 + speed * 0.4);
      if (d.life <= 0) { d.life = 0.6 + (d.x * 7 % 1) * 1.6; d.streak = 0; d.y = (d.x * 13 % 1) * 0.5; }
      // occasionally a drop lets go and streaks down
      if (d.streak > 0 || (wx === 'storm' && d.life < 0.4)) { d.streak += dt * (0.10 + speed * 0.25); }
      const x = d.x * W, y = (d.y + d.streak) * H;
      ctx.fillStyle = 'rgba(200,224,255,0.16)';
      ctx.beginPath(); ctx.ellipse(x, y, d.r, d.r * 1.25, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(x - d.r * 0.3, y - d.r * 0.4, d.r * 0.28, 0, 7); ctx.fill();
      if (d.streak > 0) { ctx.strokeStyle = 'rgba(200,224,255,0.12)'; ctx.lineWidth = d.r * 0.7; ctx.beginPath(); ctx.moveTo(x, y - d.streak * H); ctx.lineTo(x, y); ctx.stroke(); }
    }
  }
  if (wx === 'storm') {
    st.flash = Math.max(0, st.flash - dt * 2.6);
    st.boltT -= dt;
    if (st.boltT <= 0 && Math.random() < 0.04) {
      st.flash = 0.9; st.boltT = 1.5 + Math.random() * 4;
      const bx = 0.2 + Math.random() * 0.6; const pts = [[bx, 0]];
      let cy = 0; while (cy < 0.55) { cy += 0.06 + Math.random() * 0.06; pts.push([pts[pts.length - 1][0] + (Math.random() - 0.5) * 0.14, cy]); }
      st.bolt = pts;
    }
    if (st.flash > 0) {
      ctx.fillStyle = `rgba(220,232,255,${st.flash * 0.35})`; ctx.fillRect(0, 0, W, H);
      if (st.bolt && st.flash > 0.4) {
        ctx.strokeStyle = `rgba(240,248,255,${st.flash})`; ctx.lineWidth = 2; ctx.shadowColor = 'rgba(200,224,255,0.9)'; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.moveTo(st.bolt[0][0] * W, 0); for (const [px, py] of st.bolt) ctx.lineTo(px * W, py * H); ctx.stroke(); ctx.shadowBlur = 0;
      }
    }
  }
}

const WX_LABEL = { rain: '☔ RAIN', storm: '⛈ STORM', snow: '❄ SNOW', ash: '⛆ ASHFALL', dust: '⛆ DUST', fog: '🌫 FOG', cloudy: '☁ OVERCAST', clear: '☀ CLEAR' };
function drawWxBadge(ctx, W, wx, wind) {
  const label = WX_LABEL[wx] || (wx ? wx.toUpperCase() : 'CLEAR');
  const txt = wind ? `${label}  ${Math.round(wind)}kt` : label;
  ctx.font = '10px monospace'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(txt).width + 14, x = W - w - 8, y = 8, h = 17;
  ctx.fillStyle = 'rgba(6,12,18,0.6)'; ctx.strokeStyle = 'rgba(143,208,255,0.35)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, 4) : ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke();
  ctx.fillStyle = wx === 'storm' ? '#ffcf3e' : '#a9d4ec'; ctx.textAlign = 'left';
  ctx.fillText(txt, x + 7, y + h / 2 + 0.5); ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}

function drawRunway(ctx, W, H, horizonY, height, scroll, phase) {
  const t = clamp(height, 0, 1);
  // near edge: on the deck it fills the bottom; climbing/high it recedes to the horizon.
  const nearY = horizonY + (H - horizonY) * (1 - t * 0.92);
  const nearHalf = (W * 0.42) * (1 - t * 0.72);
  const farHalf = Math.max(3, nearHalf * 0.10);
  const cx = W / 2;
  ctx.fillStyle = 'rgba(18,22,26,0.92)';
  ctx.beginPath(); ctx.moveTo(cx - nearHalf, nearY); ctx.lineTo(cx + nearHalf, nearY); ctx.lineTo(cx + farHalf, horizonY); ctx.lineTo(cx - farHalf, horizonY); ctx.closePath(); ctx.fill();
  // edge lines
  ctx.strokeStyle = 'rgba(220,232,214,0.8)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx - nearHalf, nearY); ctx.lineTo(cx - farHalf, horizonY); ctx.moveTo(cx + nearHalf, nearY); ctx.lineTo(cx + farHalf, horizonY); ctx.stroke();
  // centreline dashes (scroll)
  ctx.strokeStyle = 'rgba(230,240,220,0.85)';
  for (let k = 0; k < 8; k++) {
    const f0 = ((k + scroll) % 8) / 8, f1 = f0 + 0.045; if (f1 > 1) continue;
    const y0 = lerp(horizonY, nearY, f0 * f0), y1 = lerp(horizonY, nearY, f1 * f1);
    ctx.lineWidth = lerp(0.6, 4, f0); ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx, y1); ctx.stroke();
  }
  // threshold bars near the touchdown zone when low (landing) / at the start (takeoff)
  if (t < 0.5) {
    ctx.fillStyle = 'rgba(240,244,220,0.7)';
    for (let b = -3; b <= 3; b++) { const bw = nearHalf * 0.09; ctx.fillRect(cx + b * (nearHalf * 0.24) - bw / 2, nearY - 10, bw, 8); }
  }
}

function drawPad(ctx, W, H, horizonY, height, drift) {
  const t = clamp(height, 0, 1);
  const cx = W / 2 + drift * W * 0.34;
  const cy = horizonY + (H - horizonY) * (1 - t * 0.85);
  const r = (W * 0.30) * (1 - t * 0.7) + 10;
  ctx.strokeStyle = 'rgba(79,224,160,0.9)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.42, 0, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx, cy, r * 0.66, r * 0.28, 0, 0, 7); ctx.stroke();
  ctx.fillStyle = 'rgba(79,224,160,0.9)'; ctx.font = `bold ${Math.round(r * 0.5)}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('H', cx, cy);
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}

// The airport silhouette flanking the runway — depth layers of terrain-appropriate
// structures on both sides, drawn far→near so nearer ones overlap. `cfg` is the
// AIRPORT theme entry (which feature drawer + accent colour).
function drawAirportScenery(ctx, W, H, horizonY, cfg, night, now) {
  const cx = W / 2, depth = H - horizonY;
  if (depth < 8) return;
  const layers = [0.14, 0.30, 0.50, 0.74, 0.96];
  for (let li = 0; li < layers.length; li++) {
    const d = layers[li];
    const y = horizonY + depth * Math.pow(d, 1.35);
    if (y <= horizonY + 1) continue;
    const scale = 0.10 + d * 1.0;
    const spread = W * (0.16 + d * 0.5);   // flank distance off the runway centreline
    for (const sgn of [-1, 1]) for (let n = 0; n < 2; n++) {
      const seed = li * 9 + n * 17 + (sgn > 0 ? 101 : 0);
      const jx = (frac(seed) - 0.5) * W * 0.14 * (0.4 + d);
      const sz = scale * (0.85 + frac(seed + 5) * 0.5);
      const x = cx + sgn * (spread + n * W * 0.13 * (0.4 + d)) + jx;
      if (x < -W * 0.2 || x > W * 1.2) continue;
      drawAirportFeature(ctx, cfg.feat, x, y, sz, depth, cfg, night, now, seed);
    }
  }
}

function drawAirportFeature(ctx, type, x, gy, scale, depth, cfg, night, now, seed) {
  const acc = cfg.accent, dim = 0.55 + scale * 0.45;
  const col = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
  if (type === 'building') {
    const bw = 16 + scale * 42, bh = 28 + scale * depth * 0.95 * (0.7 + frac(seed) * 0.6);
    ctx.fillStyle = col(22 + night * 4, 26 + night * 3, 34, 0.95);
    ctx.fillRect(x - bw / 2, gy - bh, bw, bh);
    ctx.strokeStyle = col(acc[0], acc[1], acc[2], 0.2); ctx.lineWidth = 1; ctx.strokeRect(x - bw / 2, gy - bh, bw, bh);
    if (scale > 0.25) {
      const cols = Math.max(2, Math.round(bw / 9)), rows = Math.max(3, Math.round(bh / 11));
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
        if (((c * 7 + r * 13 + (seed | 0)) % 5) >= (night > 0.4 ? 3 : 1)) continue;
        ctx.fillStyle = night > 0.4 ? 'rgba(255,214,120,0.8)' : 'rgba(150,180,205,0.4)';
        ctx.fillRect(x - bw / 2 + 3 + c * (bw - 6) / cols, gy - bh + 3 + r * (bh - 6) / rows, Math.max(1.4, (bw - 6) / cols - 3), Math.max(1.4, (bh - 6) / rows - 3));
      }
    }
    return;
  }
  if (type === 'crane') {
    const h0 = 26 + scale * depth * 0.8, w = 10 + scale * 18, boom = w * 2.6;
    ctx.strokeStyle = col(acc[0], acc[1], acc[2], 0.85); ctx.lineWidth = Math.max(1, scale * 2.2); ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x - w, gy); ctx.lineTo(x - w * 0.25, gy - h0); ctx.moveTo(x + w, gy); ctx.lineTo(x + w * 0.25, gy - h0); ctx.stroke();     // legs
    ctx.beginPath(); ctx.moveTo(x - boom * 0.45, gy - h0 * 0.92); ctx.lineTo(x + boom, gy - h0); ctx.stroke();                                            // boom
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + boom, gy - h0); ctx.lineTo(x + boom, gy - h0 * 0.5); ctx.stroke();                                  // hoist cable
    const cc = [[176, 92, 70], [70, 122, 160], [150, 150, 84]];
    for (let i = 0; i < 3; i++) { const c = cc[(seed + i) % 3]; ctx.fillStyle = col(c[0] * dim, c[1] * dim, c[2] * dim, 0.92); ctx.fillRect(x - w - 4 + i * (7 + scale * 3), gy - (6 + scale * 4), 8 + scale * 4, 6 + scale * 4); }  // container stack
    return;
  }
  if (type === 'gantry') {
    const h0 = 20 + scale * depth * 0.6, w = 14 + scale * 22;
    ctx.strokeStyle = col(acc[0], acc[1], acc[2], 0.8); ctx.lineWidth = Math.max(1, scale * 2);
    ctx.strokeRect(x - w, gy - h0, w * 2, h0);
    ctx.beginPath(); ctx.moveTo(x - w, gy - h0 * 0.5); ctx.lineTo(x + w, gy - h0 * 0.5); ctx.stroke();   // trolley beam
    ctx.fillStyle = col(72 * dim, 66 * dim, 54 * dim, 0.9); ctx.fillRect(x - w * 0.7, gy - (8 * scale + 4), w * 1.4, 8 * scale + 4);   // freight car
    return;
  }
  if (type === 'stack') {
    const h0 = 34 + scale * depth * 1.0, w = 6 + scale * 9;
    const gr = ctx.createLinearGradient(x - w, 0, x + w, 0);
    gr.addColorStop(0, col(30, 24, 22)); gr.addColorStop(0.5, col(58 * dim, 46 * dim, 40 * dim)); gr.addColorStop(1, col(24, 18, 16));
    ctx.fillStyle = gr; ctx.fillRect(x - w, gy - h0, w * 2, h0);
    const eg = ctx.createRadialGradient(x, gy - h0, 1, x, gy - h0, 10 + scale * 8);
    eg.addColorStop(0, 'rgba(255,140,60,0.8)'); eg.addColorStop(1, 'rgba(255,90,40,0)');
    ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(x, gy - h0, 10 + scale * 8, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(58,52,48,0.22)';
    for (let i = 0; i < 3; i++) { const t = (now * 0.0004 + frac(seed + i)) % 1; ctx.beginPath(); ctx.arc(x + Math.sin(now * 0.001 + i) * 6 * scale, gy - h0 - 6 - t * 30 * scale, (3 + i * 2) * scale, 0, 7); ctx.fill(); }
    return;
  }
  if (type === 'rock') {
    const h0 = 16 + scale * depth * 0.55, w = 14 + scale * 30;
    ctx.fillStyle = col(80 * dim, 60 * dim, 42 * dim, 0.95);
    ctx.beginPath(); ctx.moveTo(x - w, gy); ctx.lineTo(x - w * 0.4, gy - h0 * 0.7); ctx.lineTo(x - w * 0.05, gy - h0); ctx.lineTo(x + w * 0.4, gy - h0 * 0.6); ctx.lineTo(x + w, gy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col(116 * dim, 88 * dim, 60 * dim, 0.5);   // sunlit face
    ctx.beginPath(); ctx.moveTo(x - w * 0.05, gy - h0); ctx.lineTo(x + w * 0.4, gy - h0 * 0.6); ctx.lineTo(x + w, gy); ctx.lineTo(x + w * 0.2, gy); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(96,84,52,0.5)'; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) { const sx = x + (frac(seed + i) - 0.5) * w * 1.4; ctx.beginPath(); ctx.moveTo(sx, gy); ctx.lineTo(sx - 2, gy - 4 * scale); ctx.moveTo(sx, gy); ctx.lineTo(sx + 2, gy - 4 * scale); ctx.stroke(); }
    return;
  }
  // hangar (default) — a low arched shed with a door seam
  const w = 24 + scale * 44, h = 14 + scale * 24;
  ctx.fillStyle = col(40 * dim, 46 * dim, 44 * dim, 0.95);
  ctx.beginPath(); ctx.moveTo(x - w / 2, gy); ctx.lineTo(x - w / 2, gy - h * 0.5); ctx.quadraticCurveTo(x, gy - h * 1.4, x + w / 2, gy - h * 0.5); ctx.lineTo(x + w / 2, gy); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = col(acc[0], acc[1], acc[2], 0.28); ctx.lineWidth = 1; ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy - h * 0.85); ctx.stroke();
}

function drawObstacle(ctx, x, gy, scale, depth, kind, night, now) {
  if (kind === 'field') {
    const r = 8 + scale * 26;
    ctx.strokeStyle = 'rgba(70,224,90,0.85)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(x, gy, r, r * 0.4, 0, 0, 7); ctx.stroke();
    const blink = 0.4 + 0.6 * Math.abs(Math.sin(now * 0.004));
    ctx.fillStyle = `rgba(120,255,150,${blink})`; ctx.beginPath(); ctx.arc(x, gy - r * 0.4, 2 + scale * 2, 0, 7); ctx.fill();
    return;
  }
  if (kind === 'nofly') {
    const h = 30 + scale * depth * 0.7, w = 10 + scale * 34;
    const gr = ctx.createLinearGradient(0, gy - h, 0, gy);
    gr.addColorStop(0, 'rgba(255,60,60,0)'); gr.addColorStop(1, 'rgba(255,60,60,0.32)');
    ctx.fillStyle = gr; ctx.fillRect(x - w / 2, gy - h, w, h);
    ctx.strokeStyle = 'rgba(255,90,90,0.8)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x - w / 2, gy - h); ctx.lineTo(x - w / 2, gy); ctx.moveTo(x + w / 2, gy - h); ctx.lineTo(x + w / 2, gy); ctx.stroke();
    ctx.fillStyle = `rgba(255,80,80,${0.5 + 0.5 * Math.abs(Math.sin(now * 0.006))})`; ctx.beginPath(); ctx.arc(x, gy - h, 2.5 + scale * 2, 0, 7); ctx.fill();
    return;
  }
  // land → a building/structure silhouette with a few lit windows
  const bh = 24 + scale * depth * 0.85, bw = 14 + scale * 40;
  ctx.fillStyle = `rgba(${18 + night * 6},${22 + night * 4},${28},0.92)`;
  ctx.fillRect(x - bw / 2, gy - bh, bw, bh);
  ctx.strokeStyle = 'rgba(120,150,170,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(x - bw / 2, gy - bh, bw, bh);
  if (scale > 0.2) {
    const cols = Math.max(2, Math.round(bw / 9)), rows = Math.max(2, Math.round(bh / 11));
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      const lit = ((c * 7 + r * 13) % 5) < (night > 0.4 ? 3 : 1);
      if (!lit) continue;
      ctx.fillStyle = night > 0.4 ? 'rgba(255,214,120,0.85)' : 'rgba(150,180,200,0.5)';
      ctx.fillRect(x - bw / 2 + 3 + c * (bw - 6) / cols, gy - bh + 3 + r * (bh - 6) / rows, Math.max(1.5, bw / cols - 3), Math.max(1.5, bh / rows - 3));
    }
  }
}

function drawWeather(ctx, W, H, wx, st, dt, speed) {
  if (wx === 'rain' || wx === 'storm') {
    const n = wx === 'storm' ? 90 : 55, slant = wx === 'storm' ? 6 : 3;
    ctx.strokeStyle = `rgba(180,205,235,${wx === 'storm' ? 0.4 : 0.28})`; ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const p = st.parts[i]; p.y = (p.y + (0.9 + p.v) * dt * (1.4 + speed)) % 1; p.x = (p.x + 0.02 * dt) % 1;
      const x = p.x * W, y = p.y * H, len = 10 + p.v * 12;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - slant, y + len); ctx.stroke();
    }
    if (wx === 'storm' && Math.abs(Math.sin(st.scroll * 40)) > 0.985) { ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(0, 0, W, H); }
  } else if (wx === 'snow') {
    ctx.fillStyle = 'rgba(240,246,255,0.8)';
    for (let i = 0; i < 60; i++) { const p = st.parts[i]; p.y = (p.y + (0.18 + p.v * 0.12) * dt) % 1; const x = (p.x + Math.sin(st.scroll * 3 + i) * 0.02) * W, y = p.y * H; ctx.beginPath(); ctx.arc(x, y, 1 + p.v, 0, 7); ctx.fill(); }
  } else if (wx === 'ash' || wx === 'dust') {
    ctx.fillStyle = 'rgba(200,140,90,0.5)';
    for (let i = 0; i < 60; i++) { const p = st.parts[i]; p.y = (p.y + (0.2 + p.v * 0.1) * dt) % 1; p.x = (p.x + 0.06 * dt) % 1; ctx.fillRect(p.x * W, p.y * H, 1.6, 1.6); }
  }
}

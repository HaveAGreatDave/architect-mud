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
//   contacts,   // air-to-air traffic (Phase A): [{dx,dy,altDiff,rng,reg,hullPct,
//               //   designated}] relative to us → aircraft blips + a target bracket
// }

import { isWeatherFxEnabled } from './weather-fx.js';
import { aircraftFaces, liveryPalette, faceBaseRgb, shadeRgb, hex2rgb } from './aircraft3d.js';

const _scenes = new Map();      // id → persistent scene state (scroll, clouds, stars, particles)
let _obsHgt = 0;                // current view altitude fraction — drawers show more of a roof/top as it climbs

// Live render tuning — mutated by the in-cockpit tuning sliders, read every frame.
export const RENDER_TUNE = {
  worldPace: 0.001,   // cruise/air pace (tiles per knot per second)
  groundBoost: 8,     // pace multiplier at zero altitude → quick down the runway
  groundDecay: 18,    // altitude e-fold (ft) for the boost → smaller = drops to cruise pace sooner after liftoff
  eh: 0.05,           // Mode-7 eye height on the GROUND (near-0 spread-out look; a floor keeps the runway from collapsing)
  climbLift: 7.0,     // eye-height ADDED per unit altitude: EH = max(floor, eh + climbLift*height). ~2 by 500ft → clears buildings
  tile: 0.85,         // Mode-7 floor tile frequency (higher = smaller terrain tiles)
  pixel: 4,           // Mode-7 render downscale → pixel chunkiness (higher = blockier/retro)
  bldgH: 3.0,         // building height scale (from the user's tuned screenshot)
  bldgFoot: 0.1,      // building footprint (width) scale (from the user's tuned screenshot)
  texRes: 1.0,        // building texture resolution (higher = crisper, lower = chunkier)
  haze: 2.2,          // how fast the floor fades into the horizon haze
  rwl: 3.2,           // runway length (tiles)
  rwyRecede: 4.0,     // how strongly climbing pushes the runway down/under
};
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

// ── Biome ground tint (the near/mid ground colour when flying over a district) ──
// Not the flat map colours — the material the ground reads as from the air: arid
// desert over the badlands, dark water over the bay, ashen concrete over industry.
const BIOME_GROUND = {
  badlands: [150, 112, 72], water: [34, 62, 88], docks: [58, 70, 80],
  ruins: [86, 82, 58], oldcoldwater: [58, 54, 50], industrial: [72, 66, 58],
  infra: [70, 74, 80], freight: [74, 78, 84], marquee: [62, 52, 66],
  citycore: [58, 60, 66], parkland: [58, 92, 54], uptown: [56, 62, 74], civic: [66, 66, 60],
  airport: [60, 64, 60],
};

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
    /* canopy A-pillars only — the curved windscreen header is drawn on the canvas
       (drawCanopy) so the top edge reads as a DA62-style bow, not a flat bar */
    .ws-frame::after { content:''; position:absolute; inset:0;
      background:
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
  // Look direction: Q/E/S swivel the camera off the nose (viewYaw ≠ 0) while the aircraft
  // keeps flying straight ahead — the WORLD renders in the look direction, but the HUD
  // (heading tape, airport tags) always reads true heading. The passenger cabin (side)
  // is a fixed 90° off the nose — always perpendicular to the direction of travel, even
  // down the runway on takeoff. Everything else is shared.
  const yawOff = v.viewYaw || (v.side ? 90 : 0);
  const vw = yawOff ? { ...v, heading: (v.heading || 0) + yawOff } : v;
  const W = cw, H = ch, speed = clamp(v.speed || 0, 0, 1), height = clamp(v.height || 0, 0, 1);
  const phase = v.phase || 'cruise';
  const wx = (v.weather || 'clear').toLowerCase();
  const sky = skyAt(v.hour == null ? 12 : v.hour);
  const side = !!v.side;                                    // passenger side window (looks 90° off the nose)
  // "Framed" = the view is seen THROUGH a window punched in the hull (passenger cabin
  // or the pilot's Q/E/S side-look), not the forward windscreen. Forward-only canopy
  // flourishes (skyline glow, speed streaks, hero clouds, the canopy bow) are all
  // suppressed so the scene reads as a porthole, and drawWindowFrame masks the hull skin.
  const framed = side || !!v.windowClass;
  // On the deck (ground/takeoff/landing) we paint a real, terrain-themed airport.
  const onDeck = phase === 'ground' || phase === 'takeoff' || phase === 'landing';
  const airport = onDeck ? airportCfg(v.airport) : null;
  st.scroll = (st.scroll + speed * dt * (1.3 - height * 0.35) * 5.2) % 1;   // faster ground rush
  st.sideScroll = (st.sideScroll + speed * dt * 0.9) % 1;   // lateral drift for the side window

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // Horizon. On the deck it tracks how much field is in view: pull the nose up (or
  // climb away) and the airport sinks off the bottom until the view "levels out"
  // into open sky. Airborne, pitch/altitude nudge it as before.
  const reveal = onDeck ? clamp(1 - Math.max(0, v.pitch || 0) / 26 - height * 0.95, 0, 1) : 0;
  const rawHorizon = onDeck
    ? lerp(H * 1.08, H * 0.42, reveal)
    : clamp(H * 0.46 + (v.pitch || 0) * H * 0.016 + (height - 0.2) * H * 0.09, H * 0.14, H * 0.84);
  // Ease the horizon across frames so the runway→sky handoff (ground phase → cruise,
  // which swaps the formula) glides instead of snapping.
  if (st.horizon == null) st.horizon = rawHorizon;
  else st.horizon += (rawHorizon - st.horizon) * Math.min(1, dt * 5);
  const horizonY = st.horizon;
  const bankRad = (v.bank || 0) * Math.PI / 180;
  // Ground palette: airport terrain colours on the deck; airborne, tint the sky's
  // ground band toward the biome you're flying over (desert tan, bay blue, urban grey).
  let gTop = airport ? mix(airport.g1, [0, 0, 0], sky.night * 0.45) : sky.g1;
  let gBot = airport ? mix(airport.g2, [0, 0, 0], sky.night * 0.5) : sky.g2;
  if (!airport && v.biomeBelow && BIOME_GROUND[v.biomeBelow]) {
    const t = mix(BIOME_GROUND[v.biomeBelow], [0, 0, 0], sky.night * 0.5);
    gTop = mix(gTop, t, 0.6); gBot = mix(gBot, mix(t, [0, 0, 0], 0.35), 0.6);
  }

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

  // Pilotwings hero clouds — big, well-defined fluffy cumulus you sail past, ONLY when the
  // weather calls for cloud. Lazily seeded, drift horizontally with parallax off speed/heading.
  if (cloudy && !framed && !onDeck) {
    if (!st.pwClouds) st.pwClouds = Array.from({ length: 5 }, (_, i) => ({ x: (i * 0.23 + 0.08) % 1, y: 0.1 + frac(i * 3.1) * 0.44, s: 0.72 + frac(i * 7.7) * 0.95, sp: 0.5 + frac(i * 2.3) * 0.8 }));
    for (const c of st.pwClouds) {
      c.x = (c.x + (0.004 + speed * 0.05) * c.sp * dt) % 1.3;
      drawPuff(ctx, (c.x - 0.15) * W, c.y * horizonY + 4, c.s * W * 0.11, litTint, baseTint, cloudAlpha * 1.05);
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

  // Perspective SCALE is a fixed focal length — independent of the horizon position,
  // so pitching (which moves the horizon) only tilts the view and never squashes the
  // world/buildings. depthGround stays for the older per-obstacle paths.
  const vx = W / 2, depthGround = H - horizonY, focal = H * 0.55;
  ctx.lineWidth = 1;
  const gridCol = rgb(mix(gTop, [180, 220, 200], 0.5), 0.16 + speed * 0.12);
  ctx.strokeStyle = gridCol;
  if (side) {
    // Side window: the ground rushes past laterally — vertical hatching that
    // scrolls sideways sells forward motion far better than a converging grid.
    // Runs on the deck too (taxi/rotate/roll-out) — the passenger's view stays
    // perpendicular to travel the whole time, never swapping to a forward look
    // down the runway.
    for (let k = 0; k < 24; k++) {
      const f = ((k / 24) + st.sideScroll) % 1, x = -OX + f * ex;
      ctx.globalAlpha = 0.09 + speed * 0.2;
      ctx.beginPath(); ctx.moveTo(x, horizonY + depthGround * 0.03); ctx.lineTo(x - 46 - speed * 34, H); ctx.stroke();
    }
    for (let k = 1; k <= 5; k++) { const y = horizonY + depthGround * (k / 5) * (k / 5); ctx.globalAlpha = 0.06; ctx.beginPath(); ctx.moveTo(-OX, y); ctx.lineTo(W + OX, y); ctx.stroke(); }
    ctx.globalAlpha = 1;
  } else if (!onDeck) {
    // Mode-7-inspired textured ground plane (forward view).
    drawMode7Floor(ctx, W, H, horizonY, focal, vw, sky, gTop);
  }

  // Pilotwings horizon: distant rolling land + a soft hazy glow along the horizon.
  if (!framed && !onDeck) {
    drawSkyline(ctx, W, H, horizonY, vw, sky);
    const glow = ctx.createLinearGradient(0, horizonY - 14, 0, horizonY + 10);
    glow.addColorStop(0, rgb(sky.hor, 0));
    glow.addColorStop(0.5, rgb(mix(sky.hor, [255, 255, 255], 0.5), 0.42 * (1 - sky.night * 0.5)));
    glow.addColorStop(1, rgb(sky.hor, 0));
    ctx.fillStyle = glow; ctx.fillRect(-OX, horizonY - 14, ex, 24);
  }

  // Atmospheric precipitation (snow/rain/ash in the air) is drawn HERE — after the sky
  // and ground but BEFORE the world objects — so buildings pass in front of it and it
  // reads as falling out in the scene, not plastered on the glass ("snowing inside").
  // The close, on-the-canopy layer (drops + streaks) is drawGlass(), painted last.
  drawWeather(ctx, W, H, wx, st, dt, speed);

  // The airport (themed scenery flanking a runway) on the deck; the pad for VTOL;
  // otherwise the zones/obstacles projected in the direction we're actually looking.
  // Skipped for the passenger's side window — that's a forward-looking scene (the
  // strip receding to a vanishing point ahead) and would break the "always
  // perpendicular" view the side hatching above already draws.
  if (airport && reveal > 0.02 && !side) {
    drawAirportScenery(ctx, W, H, horizonY, airport, sky.night, now);
    // World-anchored strip: `roll` (tiles rolled forward) slides it toward and past
    // you — the horizontal "racing down the runway" read — while `alt` (climb
    // fraction) is a SEPARATE axis that lifts/recedes it toward the horizon as you
    // rotate and climb away, so takeoff/landing reads as a shallow forward+up
    // diagonal instead of the strip just shrinking straight up in place.
    drawGroundRunway(ctx, W, H, horizonY, depthGround, { roll: v.roll || 0, alt: height }, st.scroll, sky.night);
  } else if (phase === 'vtol') {
    drawPad(ctx, W, H, horizonY, height, v.drift || 0);
  } else if (!onDeck) {
    _obsHgt = clamp(v.height || 0, 0, 1);
    // Textured 3-D world through the Mode-7 camera: roads + runway on the ground,
    // then extruded building boxes on top (depth-sorted). Fixes the flat-billboard
    // "strange perspective" and pop-in.
    const cam = makeCam(W, horizonY, focal, vw);
    drawRoads(ctx, cam, vw);
    if (vw.runway) drawRunwayTex(ctx, cam, vw);
    drawWorldObjects(ctx, cam, vw, sky, now);
    if (vw.landGuide && vw.runway) drawGuideBoxes(ctx, cam, vw, now);
    if (vw.contacts) drawContacts(ctx, cam, vw, W, H);   // air-to-air traffic (Phase A: see other craft)
  }

  // Speed streaks (motion rush from the vanishing point) — forward view only.
  if (speed > 0.12 && !framed && !onDeck) {
    ctx.strokeStyle = rgb([210, 230, 255], 0.10 + speed * 0.18); ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + st.scroll * 6;
      const len = 14 + speed * 46, r0 = 30 + ((i * 53 + st.scroll * 200) % 120);
      const dx = Math.cos(a), dy = Math.sin(a) * 0.5 - 0.25;
      ctx.beginPath(); ctx.moveTo(vx + dx * r0, horizonY + dy * r0); ctx.lineTo(vx + dx * (r0 + len), horizonY + dy * (r0 + len)); ctx.stroke();
    }
  }

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
  if (!v.windowClass) drawCanopy(ctx, W, H);   // DA62-style curved windscreen header (forward view)
  if (!v.windowClass) drawWxBadge(ctx, W, wx, v.wind);
  if (v.hud) drawHud(ctx, W, H, v);
  // Guns (Phase B): forward tracer stream + muzzle flash while firing, screen-fixed.
  if (v.firing || v.muzzle) drawGunfire(ctx, W, H, v);
  // Battle damage: a red flash + edge pulse that fades after taking a hit.
  if (v.hitFlash > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(190,20,20,${0.26 * v.hitFlash})`; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = `rgba(255,60,60,${0.65 * v.hitFlash})`; ctx.lineWidth = 6; ctx.strokeRect(3, 3, W - 6, H - 6);
    ctx.restore();
  }
  // Passenger cabin: cut the view into a window shaped to fit the aircraft.
  if (v.windowClass) drawWindowFrame(ctx, W, H, v.windowClass, v.livery);

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
// Append a rounded-rect SUBpath to the current path (no beginPath — so it can be
// combined with another shape for an even-odd fill/clip, e.g. hull-minus-window).
function roundRectSub(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function roundRectPath(ctx, x, y, w, h, r) { ctx.beginPath(); roundRectSub(ctx, x, y, w, h, r); }
// Per-class exterior HULL SKIN the window is punched through (a sensible default when
// no livery is supplied): ultralight/prop bright alloy, heli olive, heavy tan
// freighter, gunship matte green, wreck weathered grey.
const HULL_SKIN = {
  ultralight: [190, 196, 202], heli: [96, 132, 110], prop: [172, 180, 190],
  heavy: [158, 146, 120], gunship: [92, 100, 92], wreck: [120, 118, 106], default: [168, 176, 186],
};

// The passenger/side window: everything OUTSIDE a class-shaped pane is filled with the
// aircraft's EXTERIOR SKIN, so the scene reads as glimpsed through a window cut in the
// fuselage. The hull is shaded as a curved, top-lit body (rivet-lined skin panels), the
// pane gets a raised metal bezel, and the glass carries a soft reflection.
function drawWindowFrame(ctx, W, H, cls, livery) {
  const s = windowShapeFor(cls, W, H);
  // The exterior skin is the craft's own PRIMARY paint (base) when a livery is on
  // file — same colour you picked in the paint bay — falling back to the generic
  // per-class alloy/olive/etc. only when there's none to read.
  const base = (livery && hex2rgb(livery.base)) || HULL_SKIN[cls] || HULL_SKIN.default;

  // 1. HULL — clip to the region OUTSIDE the pane (canvas rect ⊕ pane, even-odd) and
  //    shade the exterior skin there. Building the compound path in one beginPath is
  //    what actually masks the surround (roundRectSub adds no beginPath of its own).
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); roundRectSub(ctx, s.x, s.y, s.w, s.h, s.r);
  ctx.clip('evenodd');
  ctx.fillStyle = rgb(base); ctx.fillRect(0, 0, W, H);
  // top-lit crown → shaded belly
  let g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgb(mix(base, [255, 255, 255], 0.24), 0.9)); g.addColorStop(0.5, rgb(base, 0)); g.addColorStop(1, rgb(mix(base, [0, 0, 0], 0.5), 0.85));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // fuselage curvature: darker toward the far left & right edges
  g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, rgb(mix(base, [0, 0, 0], 0.45), 0.6)); g.addColorStop(0.5, rgb(base, 0)); g.addColorStop(1, rgb(mix(base, [0, 0, 0], 0.45), 0.6));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // skin panel seams above & below the window, each with a rivet row
  const seamC = rgb(mix(base, [0, 0, 0], 0.5), 0.5), rivC = rgb(mix(base, [0, 0, 0], 0.35), 0.7);
  for (const sy of [s.y - 15, s.y + s.h + 15]) {
    ctx.strokeStyle = seamC; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
    ctx.fillStyle = rivC; for (let rx = 8; rx < W; rx += 16) { ctx.beginPath(); ctx.arc(rx, sy, 0.9, 0, 7); ctx.fill(); }
  }
  ctx.restore();

  // 2. WINDOW SURROUND — a raised metal bezel (lit top-left, shadowed bottom-right)
  //    around the pane, then the thin glass edge.
  roundRectPath(ctx, s.x - 5, s.y - 5, s.w + 10, s.h + 10, s.r + 5);
  ctx.lineWidth = 7; ctx.strokeStyle = rgb(mix(base, [0, 0, 0], 0.55), 0.92); ctx.stroke();
  const bev = ctx.createLinearGradient(s.x, s.y, s.x + s.w, s.y + s.h);
  bev.addColorStop(0, 'rgba(255,255,255,0.5)'); bev.addColorStop(0.5, 'rgba(255,255,255,0)'); bev.addColorStop(1, 'rgba(0,0,0,0.45)');
  roundRectPath(ctx, s.x - 5, s.y - 5, s.w + 10, s.h + 10, s.r + 5);
  ctx.lineWidth = 3; ctx.strokeStyle = bev; ctx.stroke();
  roundRectPath(ctx, s.x, s.y, s.w, s.h, s.r);
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(160,190,215,0.32)'; ctx.stroke();

  // 3. GLASS — a soft darkening toward the frame + a diagonal reflection streak.
  ctx.save(); roundRectPath(ctx, s.x, s.y, s.w, s.h, s.r); ctx.clip();
  const ig = ctx.createRadialGradient(W / 2, H / 2, Math.min(s.w, s.h) * 0.3, W / 2, H / 2, Math.max(s.w, s.h) * 0.72);
  ig.addColorStop(0, 'rgba(0,0,0,0)'); ig.addColorStop(1, 'rgba(6,10,14,0.5)');
  ctx.fillStyle = ig; ctx.fillRect(s.x, s.y, s.w, s.h);
  const refl = ctx.createLinearGradient(s.x, s.y, s.x + s.w * 0.6, s.y + s.h);
  refl.addColorStop(0, 'rgba(255,255,255,0)'); refl.addColorStop(0.5, 'rgba(210,230,255,0.06)'); refl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = refl; ctx.fillRect(s.x, s.y, s.w, s.h);
  ctx.restore();
}

// DA62-style curved windscreen header: a dark canopy frame across the top whose lower
// edge bows UP across the centre (more glass) and reaches deeper at the corners (the
// raked A-pillar roots), plus a slim central windscreen post — so the top edge of the
// view reads as a curved canopy bow instead of a flat black bar.
function drawCanopy(ctx, W, H) {
  const midY = H * 0.055;      // header depth at the centre (glass is highest here)
  const cornerY = H * 0.20;    // header depth at the corners (raked pillar roots)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, cornerY);
  ctx.quadraticCurveTo(W * 0.5, midY, 0, cornerY);   // corner → up over centre → corner
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, cornerY);
  g.addColorStop(0, 'rgba(9,14,20,0.94)'); g.addColorStop(0.62, 'rgba(9,14,20,0.9)'); g.addColorStop(1, 'rgba(9,14,20,0)');
  ctx.fillStyle = g; ctx.fill();
  // a faint highlight along the header's inner curve (canopy sealant catching light)
  ctx.beginPath(); ctx.moveTo(0, cornerY); ctx.quadraticCurveTo(W * 0.5, midY, W, cornerY);
  ctx.strokeStyle = 'rgba(150,185,215,0.10)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
  // A short central windscreen-bow stub hanging from the header (a nod to the DA62's
  // two-panel post) — kept brief so it doesn't bisect the Mayfly's bubble canopy.
  const pw = Math.max(3, W * 0.011);
  const pg = ctx.createLinearGradient(0, 0, 0, H * 0.24);
  pg.addColorStop(0, 'rgba(9,14,20,0.6)'); pg.addColorStop(1, 'rgba(9,14,20,0)');
  ctx.fillStyle = pg; ctx.fillRect(W / 2 - pw / 2, 0, pw, H * 0.24);
}

// Water on the windscreen + storm lightning — drawn on the fixed glass, not the
// banked world, so it reads as being *on* the canopy in front of you.
function drawGlass(ctx, W, H, wx, st, dt, speed) {
  if (wx === 'rain' || wx === 'storm') {
    // At rest a released drop runs straight DOWN the canopy under gravity. With airspeed
    // the slipstream drags it back and sideways (away from centre), so the streak flattens
    // toward HORIZONTAL and the beads race off to the edges. `flat` = 0 vertical → 1 flat.
    const sp = clamp(speed, 0, 1), flat = sp * sp;
    for (const d of st.drops) {
      d.life -= dt * (0.3 + sp * 0.5);
      if (d.life <= 0) { d.life = 0.6 + (d.x * 7 % 1) * 1.6; d.streak = 0; d.y = (d.x * 13 % 1) * 0.6; }
      // A drop lets go and streaks — sooner and faster at speed (wind strips the glass).
      if (d.streak > 0 || (wx === 'storm' && d.life < 0.4) || (sp > 0.25 && d.life < 0.6)) d.streak += dt * (0.10 + sp * 0.7);
      const sideDir = d.x < 0.5 ? -1 : 1;
      // Streak direction: gravity (0,1) blended toward slipstream (sideDir, ~0) by `flat`.
      const dirX = sideDir * flat * 1.7, dirY = 1 - flat * 0.92;
      const len = d.streak * H;
      const ax = d.x * W, ay = d.y * H;               // where the bead first clung
      const x = ax + dirX * len, y = ay + dirY * len;  // current head, dragged along the streak
      // Streak trail behind the head (up toward the anchor / back toward centre).
      if (d.streak > 0.002) {
        ctx.strokeStyle = `rgba(200,224,255,${0.10 + flat * 0.06})`; ctx.lineWidth = d.r * (0.7 - flat * 0.25);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(x, y); ctx.stroke();
      }
      // The bead itself — stretched along its travel direction at speed.
      ctx.fillStyle = 'rgba(200,224,255,0.16)';
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(dirY, dirX));
      ctx.beginPath(); ctx.ellipse(0, 0, d.r * (1.25 + flat * 1.1), d.r * (1 - flat * 0.4), 0, 0, 7); ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(x - d.r * 0.3, y - d.r * 0.4, d.r * 0.28, 0, 7); ctx.fill();
    }
  }
  if (wx === 'storm' && isWeatherFxEnabled()) {
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

// Forward-view HUD (opt-in via v.hud): a sliding heading tape across the top with N/E/S/W
// letters + a fixed centre caret/readout, and an off-map "turn back" banner (v.navWarn).
const HDG_NAMES = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
function drawHud(ctx, W, H, v) {
  const hdg = (((v.heading || 0) % 360) + 360) % 360;
  const cx = W / 2, tapeY = 3, tapeH = 14, half = W * 0.34, ppd = half / 45;   // ±45° visible
  ctx.save();
  ctx.fillStyle = 'rgba(6,12,18,0.5)'; ctx.fillRect(cx - half, tapeY, half * 2, tapeH);
  ctx.beginPath(); ctx.rect(cx - half, tapeY, half * 2, tapeH); ctx.clip();
  ctx.font = '7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const base = Math.round(hdg / 10) * 10;
  for (let d = -50; d <= 50; d += 10) {
    const tv = base + d, disp = ((tv % 360) + 360) % 360, x = cx + (tv - hdg) * ppd, major = disp % 30 === 0;
    ctx.strokeStyle = 'rgba(160,200,228,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, tapeY + tapeH - (major ? 8 : 5)); ctx.lineTo(x, tapeY + tapeH); ctx.stroke();
    if (major) { ctx.fillStyle = '#a9d4ec'; ctx.fillText(HDG_NAMES[disp] || String(disp), x, tapeY + 4); }
  }
  ctx.restore();
  // Fixed centre caret + boxed read-out.
  ctx.fillStyle = '#ffcf3e'; ctx.beginPath(); ctx.moveTo(cx, tapeY + tapeH + 2); ctx.lineTo(cx - 4, tapeY + tapeH + 7); ctx.lineTo(cx + 4, tapeY + tapeH + 7); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#0b1219'; ctx.strokeStyle = '#ffcf3e'; ctx.lineWidth = 1;
  ctx.fillRect(cx - 13, tapeY + tapeH + 7, 26, 12); ctx.strokeRect(cx - 13, tapeY + tapeH + 7, 26, 12);
  ctx.fillStyle = '#ffcf3e'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(Math.round(hdg)).padStart(3, '0'), cx, tapeY + tapeH + 13.5);
  // Wind indicator (bottom-left): an arrow showing which way the wind is blowing relative to
  // the nose (up = ahead) plus its speed — so a crosswind you're crabbing into is legible.
  if (v.windVec && v.windVec.kt > 1) {
    const wx0 = 22, wy0 = H - 26, rr = 9, rel = (((v.windVec.dir - hdg) % 360) + 360) % 360 * Math.PI / 180;
    ctx.save();
    ctx.fillStyle = '#6f8698'; ctx.font = '7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('WIND', wx0, wy0 - rr - 6);
    ctx.translate(wx0, wy0);
    ctx.strokeStyle = 'rgba(150,190,220,0.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, rr, 0, 7); ctx.stroke();
    ctx.rotate(rel);
    ctx.strokeStyle = '#7ec8ff'; ctx.fillStyle = '#7ec8ff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, rr); ctx.lineTo(0, -rr); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -rr); ctx.lineTo(-3, -rr + 5); ctx.lineTo(3, -rr + 5); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#9fd0ec'; ctx.font = '7px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(v.windVec.kt) + 'kt', wx0 + rr + 4, wy0);
  }
  // Airport bearing tags — a magenta diamond + name/dist under the tape, purely
  // distance-gated (shown at any altitude). Off the ±45° tape they pin to the edge as
  // a chevron so you always know which way to turn toward the field.
  const aps = Array.isArray(v.airports) ? v.airports : [];
  if (aps.length) {
    const rowY = tapeY + tapeH + 24;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const ap of aps.slice(0, 4)) {
      const delta = (((ap.bearing - hdg) % 360) + 540) % 360 - 180;
      const off = Math.abs(delta) > 45, x = cx + clamp(delta, -45, 45) * ppd;
      ctx.fillStyle = off ? 'rgba(224,120,208,0.5)' : '#e078d0';
      ctx.beginPath(); ctx.moveTo(x, rowY - 4); ctx.lineTo(x + 3, rowY); ctx.lineTo(x, rowY + 4); ctx.lineTo(x - 3, rowY); ctx.closePath(); ctx.fill();
      ctx.font = 'bold 9px monospace';
      if (off) ctx.fillText(delta > 0 ? '›' : '‹', x + (delta > 0 ? 8 : -8), rowY);
      ctx.font = '7px monospace'; ctx.fillStyle = off ? 'rgba(224,120,208,0.7)' : '#f0a8e4';
      ctx.fillText((ap.name || 'FIELD').slice(0, 7).toUpperCase() + (ap.dist != null ? ' ' + ap.dist : ''), x, rowY + 9);
    }
  }
  // Off-map turn-back banner.
  if (v.navWarn) {
    const y = H * 0.34; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(v.navWarn).width + 18;
    ctx.fillStyle = 'rgba(40,10,6,0.74)'; ctx.strokeStyle = '#ff8a3e'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(cx - w / 2, y - 11, w, 22, 5) : ctx.rect(cx - w / 2, y - 11, w, 22); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffb23e'; ctx.fillText(v.navWarn, cx, y + 0.5);
  }
  // AA threat telegraph: a pulsing red banner spelling out the escape drill while you're
  // inside a ground-fire envelope, plus a red diamond on the tape pointing at the gun.
  if (v.threat && v.threat.exposed) {
    const t = v.threat, pulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.008);
    // directional marker on the heading tape (pins to the edge as a chevron when off-tape)
    const delta = (((t.bearing - hdg) % 360) + 540) % 360 - 180;
    const off = Math.abs(delta) > 45, mx = cx + clamp(delta, -45, 45) * ppd, my = tapeY + tapeH + 3;
    ctx.fillStyle = `rgba(255,66,66,${0.6 + pulse * 0.4})`;
    ctx.beginPath(); ctx.moveTo(mx, my + 5); ctx.lineTo(mx - 4, my); ctx.lineTo(mx + 4, my); ctx.closePath(); ctx.fill();
    if (off) { ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(delta > 0 ? '›' : '‹', mx + (delta > 0 ? 8 : -8), my + 2); }
    // banner (above the off-map banner slot so both can show)
    const y = H * 0.21, line1 = `⚠ AA THREAT — ${(t.name || 'GROUND FIRE').toUpperCase()}`, line2 = 'CLIMB TO HIGH · or FIREWALL + EVADE';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px monospace'; const w1 = ctx.measureText(line1).width;
    ctx.font = 'bold 8px monospace'; const w2 = ctx.measureText(line2).width;
    const w = Math.max(w1, w2) + 20;
    ctx.fillStyle = 'rgba(52,6,6,0.78)'; ctx.strokeStyle = `rgba(255,80,80,${0.55 + pulse * 0.45})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(cx - w / 2, y - 14, w, 34, 5) : ctx.rect(cx - w / 2, y - 14, w, 34); ctx.fill(); ctx.stroke();
    const flare = (140 + pulse * 115) | 0;
    ctx.font = 'bold 12px monospace'; ctx.fillStyle = `rgb(255,${flare},${flare})`; ctx.fillText(line1, cx, y - 3);
    ctx.font = 'bold 8px monospace'; ctx.fillStyle = '#ffd2d2'; ctx.fillText(line2, cx, y + 11);
  }
  // Hull integrity readout (bottom-right) — greens to reds as battle damage mounts.
  if (typeof v.hull === 'number' && v.hull < 100) {
    ctx.font = 'bold 9px monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillStyle = v.hull <= 25 ? '#ff5b5b' : v.hull <= 55 ? '#ffb23e' : '#7fd6a0';
    ctx.fillText(`HULL ${v.hull}%`, W - 8, H - 11);
  }
}

// The departure runway laid on the WORLD ground (not a separate airport view): it
// starts ahead of you, scrolls toward and PAST you as you roll (its near end drops
// below the bottom edge = behind you), and lifts toward the horizon + fades as you
// climb away. `rw = { roll: tiles rolled forward, alt: 0..1 climb }`.
function drawGroundRunway(ctx, W, H, horizonY, depth, rw, scroll, night) {
  const roll = rw.roll || 0, alt = clamp(rw.alt || 0, 0, 1);
  // A long strip so it doesn't "run out" during the roll; the recede is driven mainly
  // by ALTITUDE (you keep seeing runway ahead until you climb high enough), while roll
  // only slides the near threshold slowly under/behind you.
  const RWL = RENDER_TUNE.rwl, VR = 1.9, cx = W / 2;
  const fade = clamp(1.5 - alt * 1.8 - Math.max(0, roll - RWL) * 0.4, 0, 1);
  if (fade <= 0.01) return;
  const eff = (d) => d - alt * RENDER_TUNE.rwyRecede;     // climbing pushes it DOWN and off the bottom (passes under you)
  const e = (d) => clamp(eff(d) / VR, -0.6, 1);          // clamp at 1 so the far end never rises past the horizon
  const projY = (d) => horizonY + depth * (1 - e(d));    // e<0 → below the bottom edge (behind/under us)
  const wid = (d) => (W * 0.36) * clamp(1 - eff(d) / VR, 0.04, 1.4);
  const nearD = -roll * 0.6, farD = RWL - roll * 0.6;
  if (eff(farD) < -0.2) return;                           // whole strip is behind/under us
  const nY = projY(nearD), fY = projY(farD), nW = wid(nearD), fW = wid(farD);
  ctx.save(); ctx.globalAlpha = fade;
  ctx.fillStyle = 'rgba(20,22,26,0.95)';
  ctx.beginPath(); ctx.moveTo(cx - nW, nY); ctx.lineTo(cx + nW, nY); ctx.lineTo(cx + fW, fY); ctx.lineTo(cx - fW, fY); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(220,232,214,0.8)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx - nW, nY); ctx.lineTo(cx - fW, fY); ctx.moveTo(cx + nW, nY); ctx.lineTo(cx + fW, fY); ctx.stroke();
  // centreline dashes scrolling toward us
  ctx.strokeStyle = 'rgba(230,240,220,0.85)';
  for (let k = 0; k < 10; k++) {
    const f0 = ((k + scroll) % 10) / 10, f1 = f0 + 0.045;
    const y0 = lerp(fY, nY, f0 * f0), y1 = lerp(fY, nY, f1 * f1);
    ctx.lineWidth = lerp(0.6, 4, f0); ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx, y1); ctx.stroke();
  }
  // Painted markings — aiming-point blocks + touchdown-zone bar pairs at fixed points
  // on the strip (they project + scroll with the runway).
  ctx.fillStyle = 'rgba(236,240,226,0.82)';
  const paint = (d, draw) => { const ed = eff(d); if (ed < -0.1 || ed > VR - 0.05) return; draw(projY(d), wid(d)); };
  paint(RWL * 0.44 - roll * 0.6, (y, w) => { const bw = w * 0.09; ctx.fillRect(cx - w * 0.14 - bw, y - 4, bw, 8); ctx.fillRect(cx + w * 0.14, y - 4, bw, 8); });
  for (const dd of [0.22, 0.30, 0.60, 0.68]) paint(RWL * dd - roll * 0.6, (y, w) => {
    for (const sgn of [-1, 1]) { ctx.fillRect(cx + sgn * w * 0.30, y - 2, w * 0.075, 4); ctx.fillRect(cx + sgn * w * 0.42, y - 2, w * 0.075, 4); }
  });
  // edge lights (warm at night)
  for (let k = 0; k <= 8; k++) {
    const f = k / 8, y = lerp(fY, nY, f * f), w2 = lerp(fW, nW, f * f);
    ctx.fillStyle = night > 0.35 ? 'rgba(255,240,180,0.9)' : 'rgba(210,220,210,0.5)';
    ctx.beginPath(); ctx.arc(cx - w2, y, 1 + f * 1.5, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + w2, y, 1 + f * 1.5, 0, 7); ctx.fill();
  }
  // threshold bars at the far end while it's still ahead
  if (eff(farD) > 0.1) {
    ctx.fillStyle = 'rgba(240,244,220,0.7)';
    for (let b = -3; b <= 3; b++) { const bw = fW * 0.12; ctx.fillRect(cx + b * (fW * 0.26) - bw / 2, fY - 5, bw, 5); }
  }
  ctx.restore();
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

// ── Mode-7-inspired ground plane ──────────────────────────────────────────────
// A textured floor that recedes to the horizon: horizontal depth bands, perspective-
// compressed (near tall, far thin), each coloured by the BIOME it samples AHEAD from
// the map window — so the terrain you're flying toward shows on the ground (desert
// giving way to city) — fading into distance haze, with a forward-scrolling stripe
// texture + faint converging lines for motion. Not literal SNES Mode 7 — its
// principles: perspective scaling, horizon compression, texture scaling, ground motion.
// A reused low-res offscreen buffer for the Mode-7 floor.
let _m7 = null;
function m7buf(w, h) {
  if (!_m7 || _m7.w !== w || _m7.h !== h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cx = c.getContext('2d');
    _m7 = { c, cx, img: cx.createImageData(w, h), w, h };
  }
  return _m7;
}

function drawMode7Floor(ctx, W, H, horizonY, depth, v, sky, gTop) {
  if (depth <= 2) return;
  // AUTHENTIC Mode 7: sample the ground PER PIXEL into a low-res buffer, then blit it
  // up with nearest-neighbour — that's the chunky, shimmering look, most visible when
  // you turn (the whole textured plane rotates around you). Each texel samples the
  // biome ahead from the map window + a world-space terrain texture + distance haze.
  // Eye height grows with altitude → the ground spreads and falls away as you climb.
  const DS = Math.max(1, Math.round(RENDER_TUNE.pixel || 4));   // downscale = pixel chunkiness
  const X0 = -W, spanX = 3 * W;
  const bw = Math.max(2, Math.ceil(spanX / DS)), bhMax = Math.max(2, Math.ceil(H / DS));
  const buf = m7buf(bw, bhMax), data = buf.img.data;
  const Y1 = H + depth * 0.3;
  const usedH = Math.min(bhMax, Math.max(1, Math.ceil((Y1 - horizonY) / DS)));
  const EH = Math.max(0.05, RENDER_TUNE.eh + (v.height || 0) * RENDER_TUNE.climbLift);   // additive + floor: altitude adds real eye-height so you climb above buildings; floor keeps the runway/ground from collapsing at eh→0
  const hd = (v.heading || 0) * Math.PI / 180, sinh = Math.sin(hd), cosh = Math.cos(hd);
  const off = v.mapOffset, ax = off ? off.x : 0, ay = off ? off.y : 0;
  const map = v.map, R = map ? (map.length - 1) / 2 : 0;
  const cx = W / 2, halfW = W / 2, LAT = 1.15, FREQ = RENDER_TUNE.tile;
  const nm = 1 - sky.night * 0.42, hz = RENDER_TUNE.haze, hor = sky.hor;
  for (let by = 0; by < usedH; by++) {
    const p = Math.max(0.004, (horizonY + by * DS - horizonY) / depth);
    const d = EH / p;
    const haze = clamp(1 - p * hz, 0, 0.85), ih = 1 - haze;
    const hr = hor[0] * haze, hg = hor[1] * haze, hb = hor[2] * haze;
    let idx = by * bw * 4;
    for (let bx = 0; bx < bw; bx++) {
      const l = ((X0 + bx * DS - cx) / halfW) * d * LAT;
      const wx = ax + d * sinh + l * cosh, wy = ay - d * cosh + l * sinh;
      let base = BIOME_GROUND.badlands;   // off-map / open air reads as endless desert (no void border)
      if (map) { const rx = Math.round(R + wx), ry = Math.round(R + wy); if (ry >= 0 && ry < map.length && rx >= 0 && rx < map[ry].length) { const c = map[ry][rx]; if (c && c.biome) base = BIOME_GROUND[c.biome] || gTop; } }
      const wxf = wx * FREQ, wyf = wy * FREQ, tx = Math.floor(wxf * 2), ty = Math.floor(wyf * 2);
      // subtle checker + a within-tile diagonal gradient so the ground reads as textured
      const grad = ((wxf - Math.floor(wxf)) + (wyf - Math.floor(wyf))) * 0.05 - 0.05;
      const tex = 1 + (((tx + ty) & 1) ? 0.06 : -0.06) + (((tx * 5 ^ ty * 3) & 3) === 0 ? 0.05 : 0) + grad;
      data[idx] = (base[0] * tex * ih + hr) * nm; data[idx + 1] = (base[1] * tex * ih + hg) * nm; data[idx + 2] = (base[2] * tex * ih + hb) * nm; data[idx + 3] = 255;
      idx += 4;
    }
  }
  buf.cx.putImageData(buf.img, 0, 0, 0, 0, bw, usedH);
  const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buf.c, 0, 0, bw, usedH, X0, horizonY, spanX, usedH * DS);
  ctx.imageSmoothingEnabled = sm;
}

// One big, defined fluffy cumulus (Pilotwings look): a flat shaded base, rounded lit top
// lobes — solid, not wispy — so it reads as a proper cloud you fly past.
function drawPuff(ctx, cx, cy, s, lit, base, alpha) {
  const lobes = [[-0.72, 0.14, 0.6], [-0.16, -0.16, 0.82], [0.5, 0.02, 0.68], [0.06, -0.42, 0.52], [1.02, 0.22, 0.46]];
  ctx.fillStyle = rgb(mix(base, [86, 96, 112], 0.42), alpha * 0.9);
  ctx.beginPath(); ctx.ellipse(cx + s * 0.15, cy + s * 0.3, s * 1.2, s * 0.34, 0, 0, 7); ctx.fill();   // shaded flat base
  for (const [lx, ly, lr] of lobes) { ctx.fillStyle = rgb(base, alpha * 0.96); ctx.beginPath(); ctx.arc(cx + lx * s, cy + ly * s, lr * s, 0, 7); ctx.fill(); }
  for (const [lx, ly, lr] of lobes) { ctx.fillStyle = rgb(lit, alpha * 0.65); ctx.beginPath(); ctx.arc(cx + lx * s - lr * s * 0.22, cy + ly * s - lr * s * 0.26, lr * s * 0.68, 0, 7); ctx.fill(); }   // lit crowns
}

// A soft, hazy band of distant rolling land at the horizon, parallax-scrolled by
// heading — the Pilotwings far-terrain read (not hard mountains).
function drawSkyline(ctx, W, H, horizonY, v, sky) {
  const OX = W, shift = ((v.heading || 0) / 360) * W * 2.5;
  const col = mix(mix(sky.hor, sky.g2 || [40, 50, 40], 0.5), [255, 255, 255], 0.08);
  ctx.fillStyle = rgb(col, 0.42);
  ctx.beginPath(); ctx.moveTo(-OX, horizonY + 1);
  const stepx = W * 0.05;
  for (let x = -OX; x <= 2 * W; x += stepx) {
    const s = frac((x + shift) * 0.008) * 0.7 + frac((x + shift) * 0.021) * 0.3;
    ctx.lineTo(x, horizonY - (2 + s * 12));
  }
  ctx.lineTo(2 * W, horizonY + 1); ctx.closePath(); ctx.fill();
}

// ══════════════════════════════════════════════════════════════════════════════
// TEXTURED 3-D WORLD (Mode-7 camera) — buildings as extruded boxes, PNG-swappable
// ══════════════════════════════════════════════════════════════════════════════

// Texture registry. Procedural pixel-art now; `setObjectTexture(key, pngImage)` swaps
// any key to a loaded PNG later (drawImage takes a canvas OR an Image identically).
const _tex = new Map();
export function setObjectTexture(key, img) { if (img) _tex.set(key, img); }
function getTex(key, gen) { let t = _tex.get(key); if (!t) { t = gen(); _tex.set(key, t); } return t; }
function texCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

const WALL_COL = { uptown: [46, 64, 92], civic: [72, 68, 60], citycore: [52, 56, 66], marquee: [56, 40, 66], freight: [62, 66, 74], industrial: [78, 66, 54], infra: [64, 68, 78], ruins: [56, 52, 44], oldcoldwater: [52, 48, 44], docks: [58, 66, 74], __nofly: [120, 40, 40] };
const BLDG_H = { uptown: 0.36, civic: 0.21, citycore: 0.18, marquee: 0.22, freight: 0.14, industrial: 0.26, infra: 0.32, ruins: 0.16, oldcoldwater: 0.11, docks: 0.17, __nofly: 0.6 };

// Deterministic building height (render world-z units) for a tile — the SAME value
// drawWorldObjects paints (line ~1419), exposed so the flight sim can collision-check the
// exact geometry that's on the glass. Returns 0 for tiles that carry no solid building to
// fly into: open air, the runway/fields, water, the soft parkland/badlands billboards, and
// the no-fly markers (the airspace system owns those, so we don't double-punish there).
// `cell` is a map-window cell { kind, biome, ... }; wx,wy are its WORLD tile coords.
export function buildingHeightZ(wx, wy, cell) {
  if (!cell) return 0;
  const k = cell.kind, bi = cell.biome;
  if (k === 'air' || k === 'craft' || k === 'field' || k === 'nofly'
      || !bi || bi === 'water' || bi === 'parkland' || bi === 'badlands') return 0;
  const seed = (wx + 512) * 73 + (wy + 512) * 149;
  return (BLDG_H[bi] || 0.3) * (0.7 + frac(seed) * 0.6) * RENDER_TUNE.bldgH;
}

const TR = () => Math.max(0.5, RENDER_TUNE.texRes || 1);
function wallTex(biome, night) {
  const tr = TR(), nite = night > 0.4;
  return getTex('wall:' + biome + (nite ? ':n' : '') + ':' + tr, () => {
    const W = Math.round(16 * tr), H = Math.round(32 * tr), c = texCanvas(W, H), g = c.getContext('2d');
    const w = WALL_COL[biome] || [52, 56, 66];
    g.fillStyle = `rgb(${w[0]},${w[1]},${w[2]})`; g.fillRect(0, 0, W, H);
    const N = Math.round(60 * tr);
    for (let i = 0; i < N; i++) { const rx = frac(i * 3.1) * W | 0, ry = frac(i * 5.7) * H | 0; g.fillStyle = `rgba(0,0,0,${0.05 + frac(i) * 0.06})`; g.fillRect(rx, ry, 1, 1); }
    const xs = 4 * tr, ys = 5 * tr, ww = Math.max(1, 2 * tr), wh = Math.max(1, 3 * tr);
    for (let y = 3 * tr; y < H - 2 * tr; y += ys) for (let x = 2 * tr; x < W - 2 * tr; x += xs) {
      const lit = ((Math.round(x / tr) * 7 + Math.round(y / tr) * 13) % 5) < (nite ? 3 : 1);
      g.fillStyle = nite ? (lit ? 'rgba(255,214,120,0.9)' : 'rgba(14,18,26,0.85)') : (lit ? 'rgba(160,200,230,0.55)' : 'rgba(26,32,42,0.7)');
      g.fillRect(x, y, ww, wh);
    }
    return c;
  });
}
function roofTex(biome, night) {
  const tr = TR();
  return getTex('roof:' + biome + ':' + tr, () => {
    const S = Math.round(16 * tr), c = texCanvas(S, S), g = c.getContext('2d');
    const w = WALL_COL[biome] || [52, 56, 66];
    g.fillStyle = `rgb(${w[0] * 1.25 + 8 | 0},${w[1] * 1.25 + 8 | 0},${w[2] * 1.25 + 8 | 0})`; g.fillRect(0, 0, S, S);
    const N = Math.round(30 * tr);
    for (let i = 0; i < N; i++) { const rx = frac(i * 2.3) * S | 0, ry = frac(i * 4.1) * S | 0; g.fillStyle = `rgba(0,0,0,${0.06 + frac(i) * 0.08})`; g.fillRect(rx, ry, 1, 1); }
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(4 * tr, 5 * tr, 6 * tr, 4 * tr);
    g.fillStyle = 'rgba(150,180,200,0.3)'; g.fillRect(10 * tr, 10 * tr, 3 * tr, 3 * tr);
    return c;
  });
}
function roadTex() {
  const tr = TR();
  return getTex('road:' + tr, () => {
    const S = Math.round(16 * tr), c = texCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#242830'; g.fillRect(0, 0, S, S);
    const N = Math.round(24 * tr);
    for (let i = 0; i < N; i++) { const rx = frac(i * 3.7) * S | 0, ry = frac(i * 6.1) * S | 0; g.fillStyle = `rgba(255,255,255,${0.02 + frac(i) * 0.03})`; g.fillRect(rx, ry, 1, 1); }
    g.fillStyle = 'rgba(220,200,120,0.7)'; g.fillRect(S / 2 - tr, 3 * tr, 2 * tr, 6 * tr);
    return c;
  });
}
// Affine texture-mapped triangle (the Mode-7 warp). Maps texture-space triangle
// (s0,s1,s2) onto screen triangle (d0,d1,d2). Composes with the current transform.
function texTri(ctx, img, s0, s1, s2, d0, d1, d2) {
  const sx1 = s1[0] - s0[0], sy1 = s1[1] - s0[1], sx2 = s2[0] - s0[0], sy2 = s2[1] - s0[1];
  const det = sx1 * sy2 - sx2 * sy1; if (Math.abs(det) < 1e-6) return;
  const dx1 = d1[0] - d0[0], dy1 = d1[1] - d0[1], dx2 = d2[0] - d0[0], dy2 = d2[1] - d0[1];
  const a = (dx1 * sy2 - dx2 * sy1) / det, b = (dy1 * sy2 - dy2 * sy1) / det;
  const cc = (dx2 * sx1 - dx1 * sx2) / det, d = (dy2 * sx1 - dy1 * sx2) / det;
  const e = d0[0] - a * s0[0] - cc * s0[1], f = d0[1] - b * s0[0] - d * s0[1];
  ctx.save();
  ctx.beginPath(); ctx.moveTo(d0[0], d0[1]); ctx.lineTo(d1[0], d1[1]); ctx.lineTo(d2[0], d2[1]); ctx.closePath(); ctx.clip();
  ctx.transform(a, b, cc, d, e, f); ctx.imageSmoothingEnabled = false; ctx.drawImage(img, 0, 0);
  ctx.restore();
}
function drawTexQuad(ctx, img, P0, P1, P2, P3) {
  const W = img.width, H = img.height;
  texTri(ctx, img, [0, 0], [W, 0], [W, H], P0, P1, P2);
  texTri(ctx, img, [0, 0], [W, H], [0, H], P0, P2, P3);
}

// The Mode-7 camera: world tile-offset (dx,dy from the craft) + height wz → screen.
function makeCam(W, horizonY, depth, v) {
  const R = v.map ? (v.map.length - 1) / 2 : 0;
  const EH = Math.max(0.05, RENDER_TUNE.eh + (v.height || 0) * RENDER_TUNE.climbLift);   // additive + floor: altitude adds real eye-height so you climb above buildings; floor keeps the runway/ground from collapsing at eh→0
  const hd = (v.heading || 0) * Math.PI / 180, sinh = Math.sin(hd), cosh = Math.cos(hd);
  const off = v.mapOffset, ox = off ? off.x : 0, oy = off ? off.y : 0;
  const cx = W / 2, FL = (W / 2) / 1.15;
  const proj = (dx, dy, wz) => { const f = Math.max(0.06, dx * sinh - dy * cosh), l = dx * cosh + dy * sinh; return { sx: cx + (l / f) * FL, sy: horizonY + depth * (EH - wz) / f, f }; };
  const projFL = (aa, s, wz) => { const f = Math.max(0.06, aa); return { sx: cx + (s / f) * FL, sy: horizonY + depth * (EH - (wz || 0)) / f, f }; };
  return { R, sinh, cosh, ox, oy, proj, projFL, EH };   // EH exposed so airborne traffic can be placed relative to eye height
}

// One extruded, texture-mapped box between two heights (base wz0 → top wz1): painter-sorted
// walls + an optional roof. Setback towers stack several of these.
function draw3DBoxAt(ctx, cam, dx, dy, fh, wz0, wz1, biome, seed, night, alpha, roof) {
  const cs = [[-fh, -fh], [fh, -fh], [fh, fh], [-fh, fh]];
  const b = cs.map(([a, c]) => cam.proj(dx + a, dy + c, wz0));
  const t = cs.map(([a, c]) => cam.proj(dx + a, dy + c, wz1));
  const wall = wallTex(biome, night), shade = [0.0, 0.16, 0.3, 0.12];
  ctx.globalAlpha = alpha;
  const faces = [];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; faces.push({ af: (b[i].f + b[j].f) / 2, i, j }); }
  faces.sort((x, y) => y.af - x.af);
  for (const fc of faces) {
    const P0 = [t[fc.i].sx, t[fc.i].sy], P1 = [t[fc.j].sx, t[fc.j].sy], P2 = [b[fc.j].sx, b[fc.j].sy], P3 = [b[fc.i].sx, b[fc.i].sy];
    drawTexQuad(ctx, wall, P0, P1, P2, P3);
    if (shade[fc.i]) { ctx.beginPath(); ctx.moveTo(P0[0], P0[1]); ctx.lineTo(P1[0], P1[1]); ctx.lineTo(P2[0], P2[1]); ctx.lineTo(P3[0], P3[1]); ctx.closePath(); ctx.fillStyle = `rgba(0,0,0,${shade[fc.i]})`; ctx.fill(); }
  }
  if (roof) drawTexQuad(ctx, roofTex(biome, night), [t[0].sx, t[0].sy], [t[1].sx, t[1].sy], [t[2].sx, t[2].sy], [t[3].sx, t[3].sy]);
  ctx.globalAlpha = 1;
}
function draw3DBox(ctx, cam, dx, dy, fh, wz, biome, seed, night, alpha) {
  draw3DBoxAt(ctx, cam, dx, dy, fh, 0, wz, biome, seed, night, alpha, true);
}

// Corporate glass skyscraper (downtown civic/uptown): a stack of setback tiers — each
// narrower and higher, more tiers = taller — with the exposed tier roofs reading as
// setback ledges, and ~half topped by a spire with a blinking red beacon. Variety comes
// from the (world-stable) seed, so a downtown block reads as a varied skyline.
function drawSkyscraper(ctx, cam, dx, dy, fh, h, biome, seed, night, alpha, now) {
  const tiers = seed % 4;                        // 0 = plain block, up to 3 setbacks
  const H = h * (1 + tiers * 0.45);              // more-tiered towers stand taller
  let w = fh * 1.12, z = 0;                       // a touch wider than the generic box for presence
  for (let i = 0; i <= tiers; i++) {
    const z1 = H * ((i + 1) / (tiers + 1));
    draw3DBoxAt(ctx, cam, dx, dy, w, z, z1, biome, seed + i * 7, night, alpha, true);
    z = z1; w *= 0.72;
  }
  if ((seed & 1) === 0 && tiers >= 1) {           // spire + beacon on some
    const base = cam.proj(dx, dy, H), tip = cam.proj(dx, dy, H + h * 0.6);
    if (base.f > 0.1 && tip.f > 0.1) {
      ctx.globalAlpha = alpha; ctx.strokeStyle = 'rgba(190,205,225,0.85)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(base.sx, base.sy); ctx.lineTo(tip.sx, tip.sy); ctx.stroke();
      ctx.fillStyle = `rgba(255,80,80,${0.45 + 0.45 * Math.abs(Math.sin((now || 0) * 0.004 + seed))})`;
      ctx.beginPath(); ctx.arc(tip.sx, tip.sy, 1.6, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    }
  }
}

function drawTreeBB(ctx, cam, dx, dy, night, seed, alpha) {
  const p = cam.proj(dx, dy, 0), s = clamp(34 / p.f, 3, 64), n = 2 + (seed % 3);
  ctx.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    const ox = (frac(seed + i) - 0.5) * s * 1.1, r = s * (0.3 + frac(seed + i * 2) * 0.22), tx = p.sx + ox, ty = p.sy - r * 0.5;
    ctx.fillStyle = 'rgb(28,56,30)'; ctx.beginPath(); ctx.ellipse(tx, ty, r, r * 0.9, 0, 0, 7); ctx.fill();
    ctx.fillStyle = `rgb(${56 + night * 0},${94},${50})`; ctx.beginPath(); ctx.ellipse(tx - r * 0.2 * (1 - _obsHgt), ty - r * 0.3 * (1 - _obsHgt), r * (0.55 + _obsHgt * 0.4), r * (0.5 + _obsHgt * 0.4), 0, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function drawRockBB(ctx, cam, dx, dy, night, seed, alpha) {
  const p = cam.proj(dx, dy, 0), s = clamp(22 / p.f, 2, 40);
  ctx.globalAlpha = alpha; ctx.fillStyle = 'rgb(120,92,60)';
  ctx.beginPath(); ctx.moveTo(p.sx - s, p.sy); ctx.lineTo(p.sx - s * 0.3, p.sy - s * 0.7); ctx.lineTo(p.sx + s * 0.4, p.sy - s * 0.5); ctx.lineTo(p.sx + s, p.sy); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
}

// ── Air-to-air traffic ────────────────────────────────────────────────────────
// Each contact is { dx, dy, altDiff, rng, reg, hullPct, cls, hdg, bank, pitch, designated }
// relative to us (world tiles + altitude delta in feet + the bogey's own attitude). We
// build a low-poly aircraft model in the contact's local frame and project every vertex
// through the SAME Mode-7 camera as the buildings — so aspect angle (which way it's
// pointing), bank, pitch and perspective all come out physically correct for free.
const CONTACT_ALT_K = 1 / 600;   // feet of altitude delta → world-z units (tune)
const CONTACT_VS = 1.6;          // vertical exaggeration so the projected model isn't screen-squashed (tune)
const CONTACT_SIZE = { ultralight: 0.085, heli: 0.11, prop: 0.11, heavy: 0.17, gunship: 0.13, wreck: 0.10 };
function drawContacts(ctx, cam, v, W, H) {
  const cs = v.contacts; if (!cs || !cs.length) return;
  ctx.save();
  for (const c of cs) {
    // Camera-space forward (f) / lateral-right (l) — same basis cam.proj uses.
    const f = c.dx * cam.sinh - c.dy * cam.cosh, l = c.dx * cam.cosh + c.dy * cam.sinh;
    const baseWz = cam.EH + (c.altDiff || 0) * CONTACT_ALT_K;
    const pc = cam.proj(c.dx, c.dy, baseWz);
    const onScreen = pc.f > 0.12 && pc.sx >= -40 && pc.sx <= W + 40 && pc.sy >= -40 && pc.sy <= H + 40;
    if (!onScreen) { drawContactChevron(ctx, c, f, l, W, H); continue; }
    ctx.globalAlpha = clamp(1.5 - pc.f / 12, 0.35, 1);    // fade into the haze with distance
    const bb = drawAircraftModel(ctx, cam, c, baseWz);
    ctx.globalAlpha = 1;
    if (c.designated && bb) {
      const cx = (bb.minx + bb.maxx) / 2, cy = (bb.miny + bb.maxy) / 2;
      const b = Math.max(11, Math.max(bb.maxx - bb.minx, bb.maxy - bb.miny) / 2 + 5);
      ctx.strokeStyle = '#ff5b5b'; ctx.lineWidth = 1.3;
      cornerBox(ctx, cx, cy, b);
      ctx.fillStyle = '#ff8a80'; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(c.reg || 'BOGEY', cx, cy - b - 11);
      ctx.fillText(`${(Math.round((c.rng || 0) * 10) / 10)}mi · ${c.hullPct ?? 100}%`, cx, cy - b - 3);
      const cue = c.altDiff > 120 ? '▲' : c.altDiff < -120 ? '▼' : '•';   // above / below / co-alt
      ctx.fillText(cue, cx + b + 6, cy);
    }
  }
  ctx.restore();
}
// The bogey's low-poly model, built nose-forward in ITS frame, oriented by its heading/
// bank/pitch, then every vertex projected through the shared camera. Depth-sorted filled
// faces (far first), painted in the craft's LIVERY (base/trim + finish sheen + pattern
// accents). The per-class model + livery shading come from the shared aircraft3d
// module — the same geometry the hangar spins on its turntable. Returns the screen
// bbox for the designator.
function drawAircraftModel(ctx, cam, c, baseWz) {
  const SIZE = CONTACT_SIZE[c.cls] || 0.11, VS = CONTACT_VS;
  const hr = (c.hdg || 0) * Math.PI / 180, roll = (c.bank || 0) * Math.PI / 180, pitch = (c.pitch || 0) * Math.PI / 180;
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fwdX = Math.sin(hr), fwdY = -Math.cos(hr), rgtX = Math.cos(hr), rgtY = Math.sin(hr);
  const P = (lp) => {
    const f = lp[0], g = lp[1], h = lp[2];
    const f1 = f * cp - h * sp, h1 = f * sp + h * cp;               // pitch (nose up = +)
    const g2 = g * cr + h1 * sr, h2 = -g * sr + h1 * cr;            // roll (right wing down = +)
    return cam.proj(c.dx + SIZE * (f1 * fwdX + g2 * rgtX), c.dy + SIZE * (f1 * fwdY + g2 * rgtY), baseWz + SIZE * VS * h2);
  };
  // Livery palette (shared with the hangar): base + trim, a finish sheen multiplier,
  // and pattern-driven accents.
  const lv = c.livery || {};
  const pal = liveryPalette(lv);
  // Project every face; depth-sort by average forward distance (far first).
  const faces = [];
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, drawn = 0;
  for (const face of aircraftFaces(c.cls)) {
    const pts = face.p.map(P);
    if (pts.some(q => q.f <= 0.07)) continue;                       // vertex behind the lens → skip (avoids blow-up)
    let af = 0; for (const q of pts) { af += q.f; if (q.sx < minx) minx = q.sx; if (q.sx > maxx) maxx = q.sx; if (q.sy < miny) miny = q.sy; if (q.sy > maxy) maxy = q.sy; }
    const col = shadeRgb(faceBaseRgb(face.role, pal), face.sh * pal.fmul);
    faces.push({ pts, af: af / pts.length, col, role: face.role }); drawn++;
  }
  if (!drawn) return null;
  faces.sort((a, b) => b.af - a.af);
  // Edge: hazard pattern flashes its trim; the designated target reads red; else a dark outline.
  const edge = c.designated ? 'rgba(255,90,80,0.95)' : pal.pat === 'hazard' ? shadeRgb(pal.trim, 1.0) : 'rgba(8,10,14,0.7)';
  ctx.lineJoin = 'round';
  for (const fc of faces) {
    ctx.beginPath(); ctx.moveTo(fc.pts[0].sx, fc.pts[0].sy);
    for (let i = 1; i < fc.pts.length; i++) ctx.lineTo(fc.pts[i].sx, fc.pts[i].sy);
    ctx.closePath();
    ctx.fillStyle = fc.col; ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke();
    // Gloss finish: a bright specular flick on the fuselage crown.
    if (lv.finish === 'gloss' && fc.role === 'body') {
      ctx.save(); ctx.clip(); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(fc.pts[0].sx, fc.pts[0].sy); ctx.lineTo(fc.pts[1].sx, fc.pts[1].sy); ctx.stroke(); ctx.restore();
    }
  }
  // Very distant/edge-on: guarantee at least a visible pip so a far bogey never vanishes.
  if (maxx - minx < 4 && maxy - miny < 4) {
    ctx.fillStyle = shadeRgb(pal.base, 1.1); ctx.beginPath(); ctx.arc((minx + maxx) / 2, (miny + maxy) / 2, 2, 0, 7); ctx.fill();
  }
  return { minx, maxx, miny, maxy };
}
// Off-screen / behind: a red chevron pinned to the view edge pointing the way to turn,
// direction from the camera-space forward/lateral of the contact (banks with the world).
function drawContactChevron(ctx, c, f, l, W, H) {
  const cx = W / 2, cy = H * 0.46;
  let dx = l, dy = -f;                                   // screen dir: ahead → up, right → right
  const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
  const rad = Math.min(W, H) * 0.42;
  const ex = clamp(cx + dx * rad, 14, W - 14), ey = clamp(cy + dy * rad, 14, H - 14);
  ctx.save(); ctx.globalAlpha = 0.9; ctx.translate(ex, ey); ctx.rotate(Math.atan2(dy, dx));
  ctx.fillStyle = 'rgba(255,91,91,0.9)';
  ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
  ctx.restore();
  if (c.designated) {
    ctx.globalAlpha = 1; ctx.fillStyle = '#ff8a80'; ctx.font = '7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(c.reg || 'BOGEY', ex, ey - 9);
  }
}
// Forward gun tracers + muzzle flash (screen-fixed — the guns are bolted to the nose).
function drawGunfire(ctx, W, H, v) {
  const cx = W / 2, aim = H * 0.46, t = _gunT();
  ctx.save(); ctx.lineCap = 'round';
  for (const sx of [W * 0.30, W * 0.70]) {
    const jx = cx + (frac(t * 0.9 + sx) - 0.5) * 12, jy = aim + (frac(t * 1.3 + sx) - 0.5) * 9;
    const g = ctx.createLinearGradient(sx, H, jx, jy);
    g.addColorStop(0, 'rgba(255,180,90,0)'); g.addColorStop(0.6, 'rgba(255,200,110,0.5)'); g.addColorStop(1, 'rgba(255,244,190,0.9)');
    ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx, H * 1.02); ctx.lineTo(jx, jy); ctx.stroke();
  }
  if (v.muzzle) { ctx.fillStyle = 'rgba(255,224,150,0.55)'; for (const sx of [W * 0.30, W * 0.70]) { ctx.beginPath(); ctx.arc(sx, H * 0.985, 5 + frac(t + sx) * 4, 0, 7); ctx.fill(); } }
  ctx.restore();
}
const _gunT = () => { try { return performance.now() * 0.02; } catch { return 0; } };
function cornerBox(ctx, cx, cy, r) {
  const k = r * 0.4;
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = cx + sx * r, y = cy + sy * r;
    ctx.moveTo(x, y); ctx.lineTo(x - sx * k, y); ctx.moveTo(x, y); ctx.lineTo(x, y - sy * k);
  }
  ctx.stroke();
}

function drawRoads(ctx, cam, v) {
  const map = v.map; if (!map || !map.length) return; const R = cam.R, tex = roadTex();
  for (let ry = 0; ry < map.length; ry++) for (let rx = 0; rx < map[ry].length; rx++) {
    const c = map[ry][rx]; if (!c || !c.road) continue;
    const dx = (rx - R) - cam.ox, dy = (ry - R) - cam.oy, f = dx * cam.sinh - dy * cam.cosh;
    if (f <= 0.08 || f > 6.5) continue;
    const P0 = cam.proj(dx - 0.5, dy - 0.5, 0), P1 = cam.proj(dx + 0.5, dy - 0.5, 0), P2 = cam.proj(dx + 0.5, dy + 0.5, 0), P3 = cam.proj(dx - 0.5, dy + 0.5, 0);
    drawTexQuad(ctx, tex, [P0.sx, P0.sy], [P1.sx, P1.sy], [P2.sx, P2.sy], [P3.sx, P3.sy]);
  }
}

// Departure runway anchored in the WORLD (origin + heading), projected through the same
// camera as the buildings — so it stays put on the ground and recedes/rotates as you fly
// away instead of tracking the nose. `rw = { ox, oy, hdg, alt }` = the runway origin's
// world offset from the craft (tiles), its heading, and the climb-fade level.
function drawRunwayTex(ctx, cam, v) {
  const rw = v.runway; if (!rw) return;
  const alt = clamp(rw.alt || 0, 0, 1);
  const RWL = RENDER_TUNE.rwl, hw = 0.15, BACK = 0.6, fMin = 0.06;
  const fade = clamp(1.4 - alt * 1.5, 0, 1); if (fade <= 0.02) return;
  const hr = (rw.hdg || 0) * Math.PI / 180;
  const dx0 = Math.sin(hr), dy0 = -Math.cos(hr);      // along-runway unit (world)
  const pxu = Math.cos(hr), pyu = Math.sin(hr);       // across-runway unit (world)
  const ox = rw.ox || 0, oy = rw.oy || 0;             // runway origin relative to the craft
  // Forward distance along the centreline is linear in t: f(t) = A + t*B. Solve for the
  // camera-plane crossing so we draw exactly the part in front of us (no behind-camera smear).
  const A = ox * cam.sinh - oy * cam.cosh, B = dx0 * cam.sinh - dy0 * cam.cosh;
  let tLo = -BACK, tHi = RWL;
  if (Math.abs(B) < 1e-4) { if (A < fMin) return; }
  else { const tc = (fMin - A) / B; if (B > 0) tLo = Math.max(tLo, tc); else tHi = Math.min(tHi, tc); }
  if (tHi - tLo < 0.03) return;
  const P = (t, s) => cam.proj(ox + t * dx0 + s * pxu, oy + t * dy0 + s * pyu, 0);
  ctx.save(); ctx.globalAlpha = fade;
  const NL = P(tLo, -hw), NR = P(tLo, hw), FL2 = P(tHi, -hw), FR = P(tHi, hw);
  ctx.fillStyle = '#22262d';
  ctx.beginPath(); ctx.moveTo(NL.sx, NL.sy); ctx.lineTo(FL2.sx, FL2.sy); ctx.lineTo(FR.sx, FR.sy); ctx.lineTo(NR.sx, NR.sy); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(228,232,236,0.82)'; ctx.lineWidth = 1.4; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(NL.sx, NL.sy); ctx.lineTo(FL2.sx, FL2.sy); ctx.moveTo(NR.sx, NR.sy); ctx.lineTo(FR.sx, FR.sy); ctx.stroke();
  // Centreline dashes fixed at each world tile along the strip.
  const cw = 0.02; ctx.fillStyle = 'rgba(236,214,120,0.85)';
  for (let t = Math.ceil(tLo); t < tHi; t += 1) {
    const lo = Math.max(tLo, t + 0.12), hi = Math.min(tHi, t + 0.62); if (hi - lo < 0.05) continue;
    const a = P(lo, -cw), b = P(lo, cw), c = P(hi, cw), d = P(hi, -cw);
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// Star Fox-style landing guide: a chain of wireframe gates on a gentle glideslope down to
// the runway threshold. Anchored in the world (same camera as the runway/buildings), the
// path reaches back proportional to your altitude and steps down to the numbers — fly
// through the boxes to descend. Purely a guide; nothing is automated. `v.landGuide = { alt }`.
function drawGuideBoxes(ctx, cam, v, now) {
  const rw = v.runway, hr = (rw.hdg || 0) * Math.PI / 180;
  const dx0 = Math.sin(hr), dy0 = -Math.cos(hr), pxu = Math.cos(hr), pyu = Math.sin(hr);
  const ox = rw.ox || 0, oy = rw.oy || 0;                 // threshold, relative to the craft
  const GS = 34;                                          // glideslope: feet of altitude per tile of approach
  const craftAlt = Math.max(0, v.landGuide.alt || 0);
  const Dtop = clamp(craftAlt / GS, 2, 15);               // how far back the path reaches (grows with altitude)
  const N = 8, halfW = 0.34, halfH = 0.32;
  const ehOf = (alt) => Math.max(0.05, RENDER_TUNE.eh + Math.min(1, Math.sqrt(Math.max(0, alt) / 3000)) * RENDER_TUNE.climbLift);
  const pulse = 0.5 + 0.5 * Math.sin((now || 0) * 0.005);
  ctx.save(); ctx.lineJoin = 'round';
  for (let i = N - 1; i >= 0; i--) {                       // far → near so nearer gates draw on top
    const t = i / (N - 1);
    const D = 0.5 + t * (Dtop - 0.5);                      // tiles before the threshold
    const wz = ehOf(D * GS);
    const cxw = ox - D * dx0, cyw = oy - D * dy0;          // approach point on the glideslope
    const f = cxw * cam.sinh - cyw * cam.cosh; if (f <= 0.12 || f > 11) continue;
    const c = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sw, sh]) => cam.proj(cxw + sw * halfW * pxu, cyw + sw * halfW * pyu, wz + sh * halfH));
    const near = i === 0;
    ctx.strokeStyle = near ? `rgba(120,255,170,${0.7 + 0.3 * pulse})` : `rgba(120,200,255,${0.3 + 0.55 * (1 - t)})`;
    ctx.lineWidth = near ? 2.4 : 1.6;
    ctx.beginPath(); ctx.moveTo(c[0].sx, c[0].sy); ctx.lineTo(c[1].sx, c[1].sy); ctx.lineTo(c[2].sx, c[2].sy); ctx.lineTo(c[3].sx, c[3].sy); ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
}

// General city-core building: a varied mix picked from the (stable) seed — plain mid-rise,
// a podium with a set-back block, a block with a rooftop mechanical penthouse (sometimes
// corner-offset), or the occasional taller tower — so the core reads as a mixed cityscape.
function drawCityBuilding(ctx, cam, dx, dy, fh, h, biome, seed, night, alpha, now) {
  const kind = seed % 5;
  if (kind === 0) { drawSkyscraper(ctx, cam, dx, dy, fh, h, biome, seed, night, alpha, now); return; }
  if (kind === 4) {                                         // wide podium + a narrower set-back block on top
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.35, 0, h * 0.32, biome, seed + 11, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh, h * 0.32, h, biome, seed, night, alpha, true);
    return;
  }
  draw3DBoxAt(ctx, cam, dx, dy, fh, 0, h, biome, seed, night, alpha, true);   // the main block
  if (kind === 1) return;                                   // plain mid-rise
  const off = kind === 3 ? fh * 0.45 : 0;                    // rooftop penthouse, corner-pushed on kind 3
  draw3DBoxAt(ctx, cam, dx + off, dy - off * 0.5, fh * 0.5, h, h + h * (0.18 + frac(seed + 2) * 0.22), biome, seed + 3, night, alpha, true);
}

// ── Per-biome adornments ──────────────────────────────────────────────────────
function drawSmoke(ctx, cam, dx, dy, wz, col, alpha, now, seed) {
  const p = cam.proj(dx, dy, wz); if (p.f <= 0.12) return;
  const s = clamp(20 / p.f, 2, 40);
  for (let i = 0; i < 3; i++) {
    const t = ((now || 0) * 0.0002 + frac(seed + i)) % 1;
    ctx.fillStyle = `rgba(${col},${alpha * 0.24 * (1 - t)})`;
    ctx.beginPath(); ctx.arc(p.sx + Math.sin((now || 0) * 0.001 + i) * s * 0.4, p.sy - t * s * 2.4 - s * 0.5, s * (0.4 + t * 0.6), 0, 7); ctx.fill();
  }
}
function drawGantry(ctx, cam, dx, dy, fh, h, alpha, seed) {
  const hh = h * 1.5, lw = fh * 1.4;
  const a = cam.proj(dx - lw, dy, 0), at = cam.proj(dx - lw, dy, hh), b = cam.proj(dx + lw, dy, 0), bt = cam.proj(dx + lw, dy, hh);
  if ([a, at, b, bt].some(p => p.f <= 0.12)) return;
  ctx.globalAlpha = alpha; ctx.strokeStyle = 'rgba(126,116,96,0.85)'; ctx.lineWidth = 1.4; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(at.sx, at.sy); ctx.lineTo(bt.sx, bt.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
  const jib = cam.proj(dx + lw * 2.1, dy, hh * 0.9);
  if (jib.f > 0.12) { ctx.beginPath(); ctx.moveTo(at.sx, at.sy); ctx.lineTo(jib.sx, jib.sy); ctx.stroke(); }
  ctx.globalAlpha = 1;
}

// ── Per-biome building archetypes (all built from draw3DBoxAt + adornments) ────
function drawIndustrial(ctx, cam, dx, dy, fh, h, bi, seed, night, alpha, now) {
  const kind = seed % 3;
  if (kind === 0) {   // plant block + chimney stack venting smoke
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.2, 0, h * 0.4, bi, seed, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.4, 0, h * 1.7, bi, seed + 2, night, alpha, true);
    drawSmoke(ctx, cam, dx, dy, h * 1.7, '72,66,60', alpha, now, seed);
  } else if (kind === 1) {   // squat storage tanks
    draw3DBoxAt(ctx, cam, dx - fh * 0.9, dy, fh * 0.8, 0, h * 0.7, bi, seed, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx + fh * 0.9, dy, fh * 0.8, 0, h * 0.55, bi, seed + 3, night, alpha, true);
  } else {   // low sprawling plant hall
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.25, 0, h * 0.8, bi, seed, night, alpha, true);
  }
}
function drawInfra(ctx, cam, dx, dy, fh, h, bi, seed, night, alpha, now) {
  if ((seed % 2) === 0) {   // cooling tower (wide base, narrower waist) venting steam
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.3, 0, h * 0.5, bi, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.0, h * 0.5, h * 1.25, bi, seed, night, alpha, true);
    drawSmoke(ctx, cam, dx, dy, h * 1.25, '210,214,220', alpha * 0.85, now, seed);
  } else {   // turbine hall + tall stack
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.3, 0, h * 0.7, bi, seed, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx + fh, dy, fh * 0.35, 0, h * 1.5, bi, seed + 2, night, alpha, true);
  }
}
function drawFreight(ctx, cam, dx, dy, fh, h, bi, seed, night, alpha, now) {
  const kind = seed % 3;
  if (kind === 1) {   // stacked shipping containers
    for (let i = 0; i < 4; i++) {
      const cx = dx + (i % 2 - 0.5) * fh * 1.1, cy = dy + (Math.floor(i / 2) - 0.5) * fh * 0.7;
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.5, 0, h * (0.26 + (i % 2) * 0.13), bi, seed + i * 5, night, alpha, true);
    }
  } else {   // long low warehouse
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.4, 0, h * (kind === 0 ? 0.5 : 0.62), bi, seed, night, alpha, true);
    if (bi === 'docks') drawGantry(ctx, cam, dx, dy, fh, h, alpha, seed);
  }
}
function drawRuin(ctx, cam, dx, dy, fh, h, bi, seed, night, alpha, now) {
  draw3DBoxAt(ctx, cam, dx, dy, fh, 0, h * (0.5 + frac(seed) * 0.45), bi, seed, night, alpha, true);   // half-standing shell
  if ((seed % 2) === 0) draw3DBoxAt(ctx, cam, dx + fh * 0.95, dy, fh * 0.55, 0, h * (0.2 + frac(seed + 1) * 0.3), bi, seed + 4, night, alpha, true);   // broken remnant
  if (bi === 'ruins') {   // Redline radioactive glow
    const g = cam.proj(dx, dy, h * 0.3);
    if (g.f > 0.12) { const s = clamp(24 / g.f, 3, 50), rg = ctx.createRadialGradient(g.sx, g.sy, 1, g.sx, g.sy, s); rg.addColorStop(0, `rgba(150,220,80,${alpha * 0.22})`); rg.addColorStop(1, 'rgba(150,220,80,0)'); ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(g.sx, g.sy, s, 0, 7); ctx.fill(); }
  }
}
function drawMarquee(ctx, cam, dx, dy, fh, h, bi, seed, night, alpha, now) {
  draw3DBoxAt(ctx, cam, dx, dy, fh, 0, h * 0.7, bi, seed, night, alpha, true);
  const b = cam.proj(dx, dy, h * 0.7), t = cam.proj(dx, dy, h * 1.05);   // rooftop neon sign
  if (b.f > 0.12 && t.f > 0.12) {
    const neon = ['#ff4a9a', '#5fd0ff', '#ffcf3e', '#7dff6a'][seed % 4];
    ctx.globalAlpha = alpha * (night ? 0.95 : 0.5); ctx.strokeStyle = neon; ctx.lineWidth = 2.2;
    if (night) { ctx.shadowColor = neon; ctx.shadowBlur = 6; }
    ctx.beginPath(); ctx.moveTo(b.sx, b.sy); ctx.lineTo(t.sx, t.sy); ctx.stroke(); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
}

// Route each biome to its archetype set — the one place building variety is chosen.
function drawBuilding(ctx, cam, dx, dy, fh, h, bi, seed, night, alpha, now) {
  switch (bi) {
    case 'uptown': case 'civic': return drawSkyscraper(ctx, cam, dx, dy, fh, h, bi, seed, night, alpha, now);
    case 'citycore': return drawCityBuilding(ctx, cam, dx, dy, fh, h, bi, seed, night, alpha, now);
    case 'industrial': return drawIndustrial(ctx, cam, dx, dy, fh, h, bi, seed, night, alpha, now);
    case 'infra': return drawInfra(ctx, cam, dx, dy, fh, h, bi, seed, night, alpha, now);
    case 'freight': case 'docks': return drawFreight(ctx, cam, dx, dy, fh, h, bi, seed, night, alpha, now);
    case 'ruins': case 'oldcoldwater': return drawRuin(ctx, cam, dx, dy, fh, h, bi, seed, night, alpha, now);
    case 'marquee': return drawMarquee(ctx, cam, dx, dy, fh, h, bi, seed, night, alpha, now);
    default: return draw3DBox(ctx, cam, dx, dy, fh, h, bi, seed, night, alpha);
  }
}

// Collect visible tiles, sort far→near, draw each (textured box / billboard).
function drawWorldObjects(ctx, cam, v, sky, now) {
  const map = v.map; if (!map || !map.length) return; const R = cam.R, night = sky.night;
  const FAR = 7.5, wcx = v.mapCenter ? v.mapCenter.x : 0, wcy = v.mapCenter ? v.mapCenter.y : 0;
  const items = [];
  for (let ry = 0; ry < map.length; ry++) for (let rx = 0; rx < map[ry].length; rx++) {
    const c = map[ry][rx]; if (!c || c.kind === 'air' || c.kind === 'craft' || c.kind === 'field' || c.biome === 'water') continue;
    const dx = (rx - R) - cam.ox, dy = (ry - R) - cam.oy, f = dx * cam.sinh - dy * cam.cosh;
    if (f <= 0.05 || f > FAR) continue;
    const lat = dx * cam.cosh + dy * cam.sinh;
    // Keep the flight path ahead clear (a building on the centreline is what you'd fly into),
    // but FADE across the corridor edge rather than hard-skip so nothing pops in/out.
    let alpha = clamp((f - 0.06) / 0.4, 0, 1) * clamp((FAR - f) / 1.6, 0, 1);   // near pass-under + soft far fade-in
    if (f > 0.1) { const corr = clamp((Math.abs(lat) - 0.45) / 0.35, 0, 1); if (corr <= 0) continue; alpha *= corr; }
    if (alpha <= 0.02) continue;
    // Seed from the WORLD tile (stable), NOT the array index — so a building keeps its shape
    // when the server recenters the map window (was the main "popping in and out" cause).
    const wx = Math.round((rx - R) + wcx), wy = Math.round((ry - R) + wcy);
    items.push({ dx, dy, f, c, alpha, seed: (wx + 512) * 73 + (wy + 512) * 149 });   // stable, positive, frac-friendly
  }
  items.sort((a, b) => b.f - a.f);
  for (const it of items) {
    const alpha = it.alpha, bi = it.c.biome;
    if (it.c.kind === 'nofly') { draw3DBox(ctx, cam, it.dx, it.dy, 0.3, 0.55, '__nofly', it.seed, night, alpha * 0.7); continue; }
    if (bi === 'parkland') { drawTreeBB(ctx, cam, it.dx, it.dy, night, it.seed, alpha); continue; }
    if (bi === 'badlands') { if ((it.seed % 3) === 0) drawRockBB(ctx, cam, it.dx, it.dy, night, it.seed, alpha); continue; }
    const h = (BLDG_H[bi] || 0.3) * (0.7 + frac(it.seed) * 0.6) * RENDER_TUNE.bldgH;
    const fh = (0.3 + frac(it.seed + 2) * 0.08) * RENDER_TUNE.bldgFoot;
    // Each biome draws its own archetype set (downtown towers, industrial stacks, freight
    // containers, dock cranes, cooling towers, broken ruins, neon marquee, …).
    drawBuilding(ctx, cam, it.dx, it.dy, fh, h, bi, it.seed, night, alpha, now);
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

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
//   worldBlend, // optional 0..1 ground↔air crossfade weight (only the charter/passenger
//               //   HUD sends this) — when set, overrides the hard cut on `phase`/onDeck
//               //   so the airport scenery and the Mode-7 world actually blend
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
  // Reverted to the original 0.001 — turns out this ISN'T purely a render/visual
  // knob: cockpit.js's tick loop uses this exact pace to advance F.pos, the same
  // position buildingCollisionAt() (CFIT) reads to measure how far forward of the
  // runway you are. climbOutClear()'s departure-corridor shield is calibrated
  // against that pace (CLIMBOUT_MAX_F tiles, height<0.2) — slow the pace down
  // without touching the shield window and altitude (gained on a real clock,
  // untouched) outruns forward tile-progress (now paced 3.3x slower), so the
  // shield drops from the altitude side while you're still geographically right
  // on top of the departure airport's buildings → an every-time CFIT crash a few
  // hundred feet up. Don't change this again without also re-deriving
  // CLIMBOUT_MAX_F/VISIBLE_NEAR_F/VISIBLE_FAR_F (windshield.js) to match, or
  // decoupling collision position tracking from the visual scroll entirely.
  worldPace: 0.001,   // cruise/air pace (tiles per knot per second)
  groundBoost: 8,     // pace multiplier at zero altitude → quick down the runway
  groundDecay: 18,    // altitude e-fold (ft) for the boost → smaller = drops to cruise pace sooner after liftoff
  eh: 0.14,           // Mode-7 eye height on the GROUND — raised from 0.05 to lift the camera so the bare near foreground drops off the bottom edge (runway reaches the bottom, no dirt shown below it); a floor still keeps the runway from collapsing
  climbLift: 7.0,     // eye-height ADDED per unit altitude: EH = max(floor, eh + climbLift*height). ~2 by 500ft → clears buildings
  tile: 0.85,         // Mode-7 floor tile frequency (higher = smaller terrain tiles)
  pixel: 4,           // Mode-7 render downscale → pixel chunkiness (higher = blockier/retro)
  bldgH: 3.0,         // building height scale (from the user's tuned screenshot)
  bldgFoot: 1.0,      // building footprint (width) scale — 1.0 fills most of the tile (a building owns its whole zone)
  texRes: 1.0,        // building texture resolution (higher = crisper, lower = chunkier)
  haze: 2.2,          // how fast the floor fades into the horizon haze
  rwl: 3.2,           // runway length (tiles)
  rwyRecede: 4.0,     // how strongly climbing pushes the runway down/under
  fov: 0.82,          // horizontal FOV / focal length (<1 pulls the scenery in toward the vanishing point = a tighter "tunnel"; 1 = the old wide spread). Pure render — collision math is world-space and unaffected.
};
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rgb = (c, a) => a == null ? `rgb(${c[0]|0},${c[1]|0},${c[2]|0})` : `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const frac = (n) => { const x = Math.sin((n + 1) * 12.9898) * 43758.5453; return x - Math.floor(x); };   // deterministic 0..1 scatter

// Gentle, deterministic ground elevation in WORLD tile space (flight-sim visual only) — a
// few low-frequency octaves of rolling relief. Small amplitude on purpose; used to hillshade
// the Mode-7 floor so the land reads as soft hills and coastal basins, never anything steep.
function groundElev(wx, wy) {
  return Math.sin(wx * 0.085 + 1.3) * Math.cos(wy * 0.07 - 0.7) * 0.6
       + Math.sin((wx + wy) * 0.043 + 2.1) * 0.4
       + Math.sin(wx * 0.19 - wy * 0.16) * 0.16;
}

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
      bugs: [],                 // canopy bug splats that accumulate over the flight (impact specks on the glass)
      bugT: 4 + rnd(3) * 6,     // seconds until the next splat
      birds: null,              // lazily-seeded ambient flock (billboards drifting in the air)
      shake: 0,                 // eased turbulence magnitude
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
  // Continuous ground↔air crossfade weight (0 = fully on the deck, 1 = fully airborne).
  // Every other caller (takeoff/landing/vtol decks, the self-flown continuous sim) leaves
  // `worldBlend` unset and gets the old hard cut on `onDeck`; the charter/passenger HUD
  // passes a real fractional value so the airport scenery and the Mode-7 world actually
  // blend across the climb-out/flare instead of swapping in a single frame.
  const worldBlend = v.worldBlend != null ? clamp(v.worldBlend, 0, 1) : (onDeck ? 0 : 1);
  const airport = worldBlend < 1 ? airportCfg(v.airport) : null;
  st.scroll = (st.scroll + speed * dt * (1.3 - height * 0.35) * 5.2) % 1;   // faster ground rush
  st.sideScroll = (st.sideScroll + speed * dt * 0.9) % 1;   // lateral drift for the side window

  // Sun in WORLD space (for building/aircraft shadows + water glint). Rises east, tracks
  // south at noon, sets west; below the horizon at night → no shadows. `dir` points toward
  // the sun in tile (dx,dy) space; shadows fall the opposite way and stretch as the sun sinks.
  const hour = v.hour == null ? 12 : v.hour;
  const dayT = clamp((hour - 6) / 12, 0, 1);                 // 0 at 06:00 … 1 at 18:00
  const sunUp = hour > 5.5 && hour < 18.5;
  const sunElev = sunUp ? Math.sin(dayT * Math.PI) : 0;      // 0 at the horizons, 1 at noon
  const sunAng = dayT * Math.PI;                             // east → south → west
  const sunFx = {
    elev: sunElev, night: sky.night,
    dir: [Math.cos(sunAng), Math.sin(sunAng)],               // toward the sun (world dx,dy)
    shadowDir: [-Math.cos(sunAng), -Math.sin(sunAng)],       // shadows fall away from it
    len: sunUp ? clamp(0.6 + (1 - sunElev) * 2.4, 0.5, 3.4) : 0,   // long shadows at low sun
    alpha: sunUp ? clamp(0.30 * (0.35 + sunElev), 0.08, 0.34) : 0,
  };

  // Turbulence: strong wind + low altitude jitters the camera a touch (eased so it's a
  // shudder, not a strobe). Zero on the deck and in calm air. Drives a sub-pixel translate
  // of the whole world below.
  const turbTarget = !framed ? clamp(((v.wind || 0) - 14) / 40, 0, 1) * (0.4 + (1 - height) * 0.6) * (0.4 + speed * 0.8) : 0;
  st.shake += (turbTarget - st.shake) * Math.min(1, dt * 3);
  const shX = st.shake * Math.sin(now * 0.031) * 3.2, shY = st.shake * Math.sin(now * 0.043 + 1.3) * 2.4;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // Horizon. On the deck it tracks how much field is in view: pull the nose up (or
  // climb away) and the airport sinks off the bottom until the view "levels out"
  // into open sky. Airborne, pitch/altitude nudge it as before.
  const reveal = (1 - worldBlend) * clamp(1 - Math.max(0, v.pitch || 0) / 26 - height * 0.95, 0, 1);
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
  // A turbulence shudder (shX/shY) rides on the translate so the whole scene trembles in wind.
  ctx.save();
  ctx.translate(W / 2 + shX, H / 2 + shY); ctx.rotate(-bankRad); ctx.translate(-W / 2, -H / 2);
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
  if (cloudy && !framed && worldBlend > 0.02) {
    if (!st.pwClouds) st.pwClouds = Array.from({ length: 5 }, (_, i) => ({ x: (i * 0.23 + 0.08) % 1, y: 0.1 + frac(i * 3.1) * 0.44, s: 0.72 + frac(i * 7.7) * 0.95, sp: 0.5 + frac(i * 2.3) * 0.8 }));
    for (const c of st.pwClouds) {
      c.x = (c.x + (0.004 + speed * 0.05) * c.sp * dt) % 1.3;
      drawPuff(ctx, (c.x - 0.15) * W, c.y * horizonY + 4, c.s * W * 0.11, litTint, baseTint, cloudAlpha * 1.05 * worldBlend);
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
  } else if (worldBlend > 0.02) {
    // Mode-7-inspired textured ground plane (forward view) — faded in by worldBlend so
    // it crossfades against the airport/runway rather than popping in with it.
    ctx.save(); ctx.globalAlpha = worldBlend;
    drawMode7Floor(ctx, W, H, horizonY, focal, vw, sky, gTop, now, sunFx);
    ctx.restore();
  }

  // Pilotwings horizon: distant rolling land + a soft hazy glow along the horizon.
  if (!framed && worldBlend > 0.02) {
    ctx.save(); ctx.globalAlpha = worldBlend;
    drawSkyline(ctx, W, H, horizonY, vw, sky);
    const glow = ctx.createLinearGradient(0, horizonY - 14, 0, horizonY + 10);
    glow.addColorStop(0, rgb(sky.hor, 0));
    glow.addColorStop(0.5, rgb(mix(sky.hor, [255, 255, 255], 0.5), 0.42 * (1 - sky.night * 0.5)));
    glow.addColorStop(1, rgb(sky.hor, 0));
    ctx.fillStyle = glow; ctx.fillRect(-OX, horizonY - 14, ex, 24);
    ctx.restore();
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
    // `reveal` already folds in (1 - worldBlend), so this fades out in step with the
    // Mode-7 world fading in below — a real crossfade instead of a hard swap.
    drawAirportScenery(ctx, W, H, horizonY, airport, sky.night, now, reveal);
    // World-anchored strip: `roll` (tiles rolled forward) slides it toward and past
    // you — the horizontal "racing down the runway" read — while `alt` (climb
    // fraction) is a SEPARATE axis that lifts/recedes it toward the horizon as you
    // rotate and climb away, so takeoff/landing reads as a shallow forward+up
    // diagonal instead of the strip just shrinking straight up in place.
    drawGroundRunway(ctx, W, H, horizonY, depthGround, { roll: v.roll || 0, alt: height }, st.scroll, sky.night, reveal);
  }
  if (phase === 'vtol') {
    drawPad(ctx, W, H, horizonY, height, v.drift || 0);
  } else if (worldBlend > 0.02) {
    _obsHgt = clamp(v.height || 0, 0, 1);
    // Textured 3-D world through the Mode-7 camera: roads + runway on the ground,
    // then extruded building boxes on top (depth-sorted). Fixes the flat-billboard
    // "strange perspective" and pop-in. Fades in with worldBlend so it crossfades
    // against the airport scenery above instead of popping in the instant the
    // ground/airborne phase flips.
    const cam = makeCam(W, horizonY, focal, vw);
    ctx.save(); ctx.globalAlpha = worldBlend;
    drawGroundSurfaces(ctx, cam, vw, sky, now);
    ctx.restore();
    if (vw.runway) drawRunwayTex(ctx, cam, vw, worldBlend, sky, now);
    // Aircraft's own shadow on the ground (cast along the sun) — reads as an altitude cue on
    // low passes/approach when the sun's behind you; culled otherwise.
    if (sunFx.elev > 0.02 && !framed) drawAircraftShadow(ctx, cam, height, sunFx, worldBlend);
    drawWorldObjects(ctx, cam, vw, sky, now, sunFx);
    if (sky.night > 0.35) drawSearchlights(ctx, cam, vw, now, worldBlend);   // sweeping beams from restricted (no-fly) blocks at night
    if (!framed) drawBirds(ctx, W, H, horizonY, vw, st, dt, speed, sky, now, worldBlend);   // ambient flock scattering as you pass
    if (vw.landGuide && vw.runway) drawGuideBoxes(ctx, cam, vw, now);
    if (vw.contacts) drawContacts(ctx, cam, vw, W, H);   // air-to-air traffic (Phase A: see other craft)
    if (vw.apTarget) drawAirportTarget(ctx, cam, vw, W, H, now);   // target-field ring / Home waypoint
  }

  // Speed streaks (motion rush from the vanishing point) — forward view only.
  if (speed > 0.12 && !framed && worldBlend > 0.02) {
    ctx.strokeStyle = rgb([210, 230, 255], (0.10 + speed * 0.18) * worldBlend); ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + st.scroll * 6;
      const len = 14 + speed * 46, r0 = 30 + ((i * 53 + st.scroll * 200) % 120);
      const dx = Math.cos(a), dy = Math.sin(a) * 0.5 - 0.25;
      ctx.beginPath(); ctx.moveTo(vx + dx * r0, horizonY + dy * r0); ctx.lineTo(vx + dx * (r0 + len), horizonY + dy * (r0 + len)); ctx.stroke();
    }
  }

  ctx.restore();   // end banked world

  // G-force grey-out: a hard, sustained bank loads you up — the edges desaturate and darken
  // as blood drains, tunnelling the view. Proxy G off bank angle (steep = high load); forward
  // view only, eased so it swells and releases smoothly.
  if (!framed) {
    const gLoad = clamp((Math.abs(v.bank || 0) - 45) / 45, 0, 1);
    st.gGrey = (st.gGrey || 0) + (gLoad - (st.gGrey || 0)) * Math.min(1, dt * 2.5);
    if (st.gGrey > 0.02) {
      const gv = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * (0.5 - st.gGrey * 0.28), W / 2, H / 2, Math.max(W, H) * 0.72);
      gv.addColorStop(0, 'rgba(90,92,96,0)'); gv.addColorStop(1, `rgba(24,26,30,${clamp(st.gGrey * 0.85, 0, 0.85)})`);
      ctx.fillStyle = gv; ctx.fillRect(0, 0, W, H);
    }
  }

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

  // On-glass weather (drops that cling to the canopy, lightning), bug splats + frost + a WX badge.
  drawGlass(ctx, W, H, wx, st, dt, speed, framed);
  if (!v.windowClass) drawCanopy(ctx, W, H);   // DA62-style curved windscreen header (forward view)
  if (!v.windowClass) drawWxBadge(ctx, W, wx, v.wind);
  if (v.hud) drawHud(ctx, W, H, v);
  // Guns (Phase B): forward tracer stream + muzzle flash while firing, screen-fixed.
  if (v.firing || v.muzzle) drawGunfire(ctx, W, H, v);
  // Incoming ground-AA tracer: shows the pilot which way the guns below are actually firing.
  if (v.aaTracer) drawAATracer(ctx, W, H, v);
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
// banked world, so it reads as being *on* the canopy in front of you. Plus the slow
// accretion that dirties a canopy over a flight: bug splats that build up, and frost
// creeping in from the corners in snow.
function drawGlass(ctx, W, H, wx, st, dt, speed, framed = false) {
  // Bug splats: while flying, the odd bug hits the glass and stays — the canopy gets
  // progressively grubbier until you land (state resets with the scene). Rain washes it.
  if (!framed && speed > 0.35 && wx !== 'rain' && wx !== 'storm') {
    st.bugT -= dt * (0.3 + speed);
    if (st.bugT <= 0) {
      st.bugT = 3 + frac(st.bugs.length * 2.7 + speed * 10) * 7;
      if (st.bugs.length < 16) st.bugs.push({ x: 0.2 + frac(st.bugs.length * 3.1) * 0.6, y: 0.15 + frac(st.bugs.length * 5.3) * 0.6, r: 1.4 + frac(st.bugs.length) * 2.2, a: 0 });
    }
  } else if (wx === 'rain' || wx === 'storm') {
    if (st.bugs.length) st.bugs = st.bugs.filter((_, i) => frac(i + st.scroll * 20) > 0.03);   // rain slowly cleans the glass
  }
  for (const b of st.bugs) {
    b.a = Math.min(1, b.a + dt * 3);
    const x = b.x * W, y = b.y * H;
    ctx.fillStyle = `rgba(120,120,80,${0.22 * b.a})`;
    ctx.beginPath(); ctx.ellipse(x, y, b.r, b.r * 0.8, 0, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(70,66,44,${0.3 * b.a})`;                        // dark speck core + a smear tail
    ctx.beginPath(); ctx.arc(x, y, b.r * 0.5, 0, 7); ctx.fill();
    ctx.strokeStyle = `rgba(110,110,74,${0.12 * b.a})`; ctx.lineWidth = b.r * 0.7;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - b.r * 3 * speed, y + b.r * 1.2); ctx.stroke();
  }
  // Frost: in snow, ice creeps in from the corners — a feathery white bloom hugging the edges.
  if (!framed && wx === 'snow') {
    const fr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.72);
    fr.addColorStop(0, 'rgba(226,240,255,0)'); fr.addColorStop(1, 'rgba(226,240,255,0.4)');
    ctx.fillStyle = fr; ctx.fillRect(0, 0, W, H);
  }
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
    const rowY = tapeY + tapeH + 24, now = performance.now();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // Draw the SELECTED target last so it sits on top of any overlapping tags.
    const ordered = aps.slice(0, 4).sort((a, b) => (a.id === v.apTargetId ? 1 : 0) - (b.id === v.apTargetId ? 1 : 0));
    for (const ap of ordered) {
      const delta = (((ap.bearing - hdg) % 360) + 540) % 360 - 180;
      const off = Math.abs(delta) > 45, x = cx + clamp(delta, -45, 45) * ppd;
      const isTgt = ap.id != null && ap.id === v.apTargetId;
      // "Lined up" = the field is dead ahead (within ~3.5°). The tag slides to centre as you
      // turn onto it and snaps to a green LINED-UP state so you know you're pointed home / can
      // return to the map on this heading.
      const lined = !off && Math.abs(delta) <= 3.5;
      if (lined && isTgt) {
        const pulse = 0.6 + 0.4 * Math.sin(now * 0.009);
        ctx.fillStyle = `rgba(79,224,160,${0.85 + pulse * 0.15})`;
        ctx.beginPath(); ctx.moveTo(x, rowY - 6); ctx.lineTo(x + 5, rowY); ctx.lineTo(x, rowY + 6); ctx.lineTo(x - 5, rowY); ctx.closePath(); ctx.fill();
        // centre-line tick up to the tape so the eye reads "aligned"
        ctx.strokeStyle = `rgba(79,224,160,${0.5 + pulse * 0.4})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, rowY - 7); ctx.lineTo(x, tapeY + tapeH); ctx.stroke();
        ctx.font = 'bold 7px monospace'; ctx.fillStyle = '#4fe0a0';
        ctx.fillText('◆ LINED UP', x, rowY - 13);
      } else {
        // Selected target is a brighter, larger diamond than the other fields.
        const sz = isTgt ? 5 : 3.5;
        ctx.fillStyle = off ? (isTgt ? 'rgba(255,207,62,0.7)' : 'rgba(224,120,208,0.5)') : (isTgt ? '#ffcf3e' : '#e078d0');
        ctx.beginPath(); ctx.moveTo(x, rowY - sz); ctx.lineTo(x + sz * 0.75, rowY); ctx.lineTo(x, rowY + sz); ctx.lineTo(x - sz * 0.75, rowY); ctx.closePath(); ctx.fill();
        if (off) { ctx.font = 'bold 9px monospace'; ctx.fillText(delta > 0 ? '›' : '‹', x + (delta > 0 ? 8 : -8), rowY); }
      }
      ctx.font = (isTgt ? 'bold ' : '') + '7px monospace';
      ctx.fillStyle = lined && isTgt ? '#8ff0c4' : off ? (isTgt ? 'rgba(255,207,62,0.85)' : 'rgba(224,120,208,0.7)') : (isTgt ? '#ffe08a' : '#f0a8e4');
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
function drawGroundRunway(ctx, W, H, horizonY, depth, rw, scroll, night, outerFade = 1) {
  const roll = rw.roll || 0, alt = clamp(rw.alt || 0, 0, 1);
  // A long strip so it doesn't "run out" during the roll; the recede is driven mainly
  // by ALTITUDE (you keep seeing runway ahead until you climb high enough), while roll
  // only slides the near threshold slowly under/behind you.
  const RWL = RENDER_TUNE.rwl, VR = 1.9, cx = W / 2;
  const fade = clamp(1.5 - alt * 1.8 - Math.max(0, roll - RWL) * 0.4, 0, 1) * outerFade;
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
function drawAirportScenery(ctx, W, H, horizonY, cfg, night, now, fade = 1) {
  const cx = W / 2, depth = H - horizonY;
  if (depth < 8) return;
  const layers = [0.14, 0.30, 0.50, 0.74, 0.96];
  ctx.save(); ctx.globalAlpha = fade;
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
  ctx.restore();
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

function drawMode7Floor(ctx, W, H, horizonY, depth, v, sky, gTop, now, sun) {
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
  // Per-tile material LUT for the small visible window (the map is a ~9×9 window), built
  // once per frame so the per-pixel sampler just indexes it: each entry is
  // [r, g, b, waterness, grassness, hillshade]. Off-map reads as endless desert (no void border).
  const OFF = BIOME_GROUND.badlands, OFF5 = [OFF[0], OFF[1], OFF[2], 0, 0, 1], mh = map ? map.length : 0;
  // Relief lighting: hillshade each tile off the procedural elevation gradient, lit by the
  // sun (a fixed NW key at night). Baked per-tile here (cheap) and bilinear-sampled per pixel.
  const wc = v.mapCenter || { x: 0, y: 0 }, wcx = wc.x, wcy = wc.y;
  const litX = sun && sun.elev > 0.05 ? sun.dir[0] : -0.62, litY = sun && sun.elev > 0.05 ? sun.dir[1] : -0.62;
  let LUT = null;
  if (map) {
    LUT = new Array(mh);
    for (let ry = 0; ry < mh; ry++) {
      const row = map[ry], out = new Array(row.length);
      for (let rx = 0; rx < row.length; rx++) {
        const c = row[rx], bi = c && c.biome;
        const col = bi ? (BIOME_GROUND[bi] || gTop) : OFF;
        const awx = (rx - R) + wcx, awy = (ry - R) + wcy;   // absolute world tile (relief stays put, doesn't slide)
        const e0 = groundElev(awx, awy), gx = groundElev(awx + 0.5, awy) - e0, gy = groundElev(awx, awy + 0.5) - e0;
        const shade = clamp(1 + (-gx * litX - gy * litY) * 2.4, 0.8, 1.2);
        out[rx] = [col[0], col[1], col[2], bi === 'water' ? 1 : 0, bi === 'parkland' ? 1 : 0, shade];
      }
      LUT[ry] = out;
    }
  }
  const sample = (rx, ry) => (LUT && ry >= 0 && ry < mh && rx >= 0 && rx < LUT[ry].length) ? LUT[ry][rx] : OFF5;
  const t = (now || 0) * 0.001;
  for (let by = 0; by < usedH; by++) {
    const p = Math.max(0.004, (horizonY + by * DS - horizonY) / depth);
    const d = EH / p;
    const haze = clamp(1 - p * hz, 0, 0.85), ih = 1 - haze;
    const hr = hor[0] * haze, hg = hor[1] * haze, hb = hor[2] * haze;
    let idx = by * bw * 4;
    for (let bx = 0; bx < bw; bx++) {
      const l = ((X0 + bx * DS - cx) / halfW) * d * LAT;
      const wx = ax + d * sinh + l * cosh, wy = ay - d * cosh + l * sinh;
      // Bilinear-blend the terrain across the four nearest tile centres so neighbouring
      // biomes (grass→road, land→water) fade into each other instead of switching hard at
      // the tile seam. waterW/grassW carry the same blend so the material treatment below
      // feathers out over the shoreline too.
      const fx = R + wx, fy = R + wy, ix = Math.floor(fx), iy = Math.floor(fy), fxr = fx - ix, fyr = fy - iy;
      const s00 = sample(ix, iy), s10 = sample(ix + 1, iy), s01 = sample(ix, iy + 1), s11 = sample(ix + 1, iy + 1);
      const w00 = (1 - fxr) * (1 - fyr), w10 = fxr * (1 - fyr), w01 = (1 - fxr) * fyr, w11 = fxr * fyr;
      let br = s00[0] * w00 + s10[0] * w10 + s01[0] * w01 + s11[0] * w11;
      let bg = s00[1] * w00 + s10[1] * w10 + s01[1] * w01 + s11[1] * w11;
      let bb = s00[2] * w00 + s10[2] * w10 + s01[2] * w01 + s11[2] * w11;
      const waterW = s00[3] * w00 + s10[3] * w10 + s01[3] * w01 + s11[3] * w11;
      const grassW = s00[4] * w00 + s10[4] * w10 + s01[4] * w01 + s11[4] * w11;
      const shadeW = s00[5] * w00 + s10[5] * w10 + s01[5] * w01 + s11[5] * w11;
      // Base material: subtle concrete checker + within-tile diagonal gradient.
      const wxf = wx * FREQ, wyf = wy * FREQ, tx = Math.floor(wxf * 2), ty = Math.floor(wyf * 2);
      const grad = ((wxf - Math.floor(wxf)) + (wyf - Math.floor(wyf))) * 0.05 - 0.05;
      let tex = 1 + (((tx + ty) & 1) ? 0.06 : -0.06) + (((tx * 5 ^ ty * 3) & 3) === 0 ? 0.05 : 0) + grad;
      // Grass: a finer mottle so parkland reads as vegetation, not a flat green slab.
      if (grassW > 0.002) {
        const gx = Math.floor(wx * 5.3), gy = Math.floor(wy * 5.3);
        tex = tex * (1 - grassW) + (1 + (((gx * 7 ^ gy * 13) & 3) * 0.05 - 0.075)) * grassW;
      }
      // Relief hillshade — brightens sun-facing slopes, darkens the lee; land only, so the
      // ground reads as gentle rolling hills. Water stays flat (its own wave shading below).
      tex *= shadeW * (1 - waterW) + waterW;
      // Water + shoreline. waterW rises 0→1 across the shore seam (bilinear), so it doubles
      // as a shoreline coordinate — ~0.5 is the waterline. On top of the blended base colour
      // we layer the cues that make a coast read as a coast instead of a colour crossfade:
      //   · travelling waves + crest glint (open water shimmer)
      //   · depth darkening as you head out from the line into deep water
      //   · an animated surf band hugging the waterline, surging in and out along the coast
      //   · a damp, darker strip of sand just above the line where the wash reaches
      let cr = 0, foam = 0, gln = 0;
      if (waterW > 0.002) {
        const wv = 0.5 * Math.sin(wx * 6.2 + wy * 1.4 + t * 2.3) + 0.5 * Math.sin((wx - wy) * 4.1 - t * 1.7);
        tex = tex * (1 - waterW) + (1 + wv * 0.12) * waterW;
        tex *= 1 - clamp((waterW - 0.5) * 2, 0, 1) * 0.18;   // shallows near the line stay lighter; open water sits darker
        if (wv > 0.82) cr = (wv - 0.82) * 5 * waterW;   // crest glint, added as a bluish-white lift below
        // Sun glitter: a bright, broken specular path across the water TOWARD the sun — the
        // water pixels whose bearing off the craft aligns with the sun light up, the swell
        // chopping the path into a shimmering trail of gold flecks.
        if (sun && sun.elev > 0.05) {
          const along = ((wx - ax) * sun.dir[0] + (wy - ay) * sun.dir[1]) / Math.max(0.6, d);
          if (along > 0.15) gln = clamp((along - 0.15) * 1.5, 0, 1) * (0.35 + 0.65 * Math.max(0, wv)) * sun.elev * waterW;
        }
        // Surf: a bright band centred just on the water side of the waterline, pulsing with
        // the swell and breaking unevenly along the coast (time + position phase).
        const band = clamp(1 - Math.abs(waterW - 0.56) / 0.16, 0, 1);
        if (band > 0) foam = band * band * (0.55 + 0.45 * Math.sin(t * 1.6 + (wx + wy) * 2.7 + wv * 1.5));
      }
      // Wet sand: the land strip just above the waterline reads damp where the wash reaches.
      if (waterW > 0.14 && waterW < 0.5) tex *= 1 - clamp(1 - Math.abs(waterW - 0.32) / 0.18, 0, 1) * 0.14;
      data[idx] = ((br * tex + cr * 55 + foam * 150 + gln * 150) * ih + hr) * nm;
      data[idx + 1] = ((bg * tex + cr * 70 + foam * 165 + gln * 132) * ih + hg) * nm;
      data[idx + 2] = ((bb * tex + cr * 90 + foam * 175 + gln * 66) * ih + hb) * nm;
      data[idx + 3] = 255;
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

const WALL_COL = { uptown: [46, 64, 92], civic: [72, 68, 60], citycore: [52, 56, 66], marquee: [56, 40, 66], freight: [62, 66, 74], industrial: [78, 66, 54], infra: [64, 68, 78], ruins: [56, 52, 44], oldcoldwater: [52, 48, 44], docks: [58, 66, 74], __nofly: [120, 40, 40],
  // Per-building / per-type palettes for the dedicated named-building models (NAMED_MODELS,
  // drawTypeModel). Each named building points at its own key so two of the same type never
  // share a wall colour; `ty_door` is the shared dark door/awning band.
  ty_office: [46, 64, 92], ty_hotel: [70, 54, 78], ty_apt_a: [58, 60, 72], ty_apt_b: [70, 64, 58],
  ty_police: [54, 68, 98], ty_clinic: [150, 178, 182], ty_studio: [66, 70, 82], ty_power: [92, 80, 64],
  ty_hangar_a: [96, 102, 112], ty_hangar_b: [84, 98, 108],
  ty_bar_a: [60, 44, 50], ty_bar_b: [50, 48, 62], ty_club: [70, 42, 80], ty_diner: [82, 72, 52],
  ty_shop_a: [64, 60, 52], ty_shop_b: [54, 62, 60], ty_shop_c: [66, 54, 58], ty_shop_d: [58, 58, 66], ty_shop_e: [62, 66, 54],
  // Embassy Hotel & Bar — warm ochre tower over a moody neon-lit bar podium.
  ty_embassy: [88, 66, 54], ty_embassy_bar: [46, 34, 42],
  // Coldwater Clone Facility — clinical off-white shell + dark glowing vat glass.
  ty_clone: [176, 200, 204], ty_clone_vat: [30, 52, 58],
  ty_door: [20, 22, 26] };
const BLDG_H = { uptown: 0.36, civic: 0.21, citycore: 0.18, marquee: 0.22, freight: 0.14, industrial: 0.26, infra: 0.32, ruins: 0.16, oldcoldwater: 0.11, docks: 0.17, __nofly: 0.6 };

// ── 3-D building standard ─────────────────────────────────────────────────────
// STANDARD: every building_type gets a 3-D representation here — an archetype (which
// drawBuilding silhouette to extrude, reusing the biome archetypes) plus a height.
// The map-window cell carries `bt` (building_type, from state.js mapWindow); the
// windshield keys the flying-over 3-D shape off it. When a NEW building_type is
// introduced, add it here AND to BUILDING_TYPE_ICON (server/engine/world.js, the 2-D
// map footprint) so a building reads consistently in both views. `default` is the
// fallback: an unknown type — or one whose entry hasn't loaded — still extrudes a
// believable mid-rise instead of vanishing. Keep the archetype in the BLDG_H key set.
const BLDG_TYPE_3D = {
  corporate_office: { a: 'uptown',    h: 0.40 }, // glass towers
  hotel:            { a: 'uptown',    h: 0.34 },
  apartment:        { a: 'citycore',  h: 0.28 },
  residential:      { a: 'citycore',  h: 0.18 },
  shop:             { a: 'citycore',  h: 0.15 },
  diner:            { a: 'citycore',  h: 0.12 },
  bar:              { a: 'marquee',   h: 0.15 },
  club:             { a: 'marquee',   h: 0.18 },
  studio:           { a: 'infra',     h: 0.22 },
  police:           { a: 'civic',     h: 0.22 },
  clinic:           { a: 'civic',     h: 0.22 },
  power:            { a: 'industrial', h: 0.34 },
  hangar:           { a: 'freight',   h: 0.14 },
  default:          { a: 'citycore',  h: 0.22 }, // fallback when a type has no entry / fails to load
};
// The archetype + base height for a map cell: a building tile (has `bt`) renders its
// type's 3-D shape (or the fallback for an unknown type); a plain tile keeps its biome.
function bldgStyle(cell) {
  const s = cell && cell.bt ? (BLDG_TYPE_3D[cell.bt] || BLDG_TYPE_3D.default) : null;
  return s ? { arch: s.a, baseH: s.h } : { arch: cell && cell.biome, baseH: BLDG_H[cell && cell.biome] || 0.3 };
}

// ── Building height by STOREYS ────────────────────────────────────────────────
// Height comes from the building's real floor count, not a per-type slab: a 3-floor
// hotel is a mid-rise, a corporate office a tower, a corner shop a single storey.
// The server passes an authored floor override (cell.flr = flags.floors) when set;
// otherwise we fall back to a believable per-type default. FLOOR_Z is the world-z
// height of one storey — the whole thing still scales with the bldgH tuning knob so
// the ⚙ slider keeps working. This is the ONE height formula; buildingHeightZ (CFIT
// collision) and drawWorldObjects (render) both call floorHeight so what you see is
// exactly what you can hit.
const TYPE_FLOORS = {
  corporate_office: 22, hotel: 6, apartment: 8, residential: 3, shop: 1, diner: 1,
  bar: 1, club: 2, studio: 2, police: 3, clinic: 3, power: 5, hangar: 1, default: 4,
};
const FLOOR_Z = 0.018;   // world-z per storey (tuned so a 22-floor office ≈ the old tower height)
function floorsOf(cell) {
  const f = cell && cell.flr;
  if (f > 0) return f;
  return (cell && TYPE_FLOORS[cell.bt]) || TYPE_FLOORS.default;
}
// Deterministic building height for a cell: floors × per-storey, with a small stable
// jitter off the seed so same-type neighbours aren't a dead-flat skyline.
function floorHeight(cell, seed) {
  return floorsOf(cell) * FLOOR_Z * (0.9 + frac(seed) * 0.2) * RENDER_TUNE.bldgH;
}

// Building footprint half-width (tile units) — a building fills most of its own tile. This
// is the SAME value the CFIT collision sweep reads (cockpit.js imports it) so a plane hits a
// tower's mass exactly where its base is drawn, not a tiny box at the tile centre. Scaled by
// the bldgFoot tuning knob at both the draw and the collision sites so they never drift.
export const BUILDING_FOOT = 0.42;

// Deterministic building height (render world-z units) for a tile — the SAME value
// drawWorldObjects paints (line ~1419), exposed so the flight sim can collision-check the
// exact geometry that's on the glass. Returns 0 for tiles that carry no solid building to
// fly into: open air, the runway/fields, water, the soft parkland/badlands billboards, the
// no-fly markers (the airspace system owns those, so we don't double-punish there), and any
// plain terrain tile — only a real building tile (has `bt`) extrudes solid mass.
// `cell` is a map-window cell { kind, biome, bt, ... }; wx,wy are its WORLD tile coords.
export function buildingHeightZ(wx, wy, cell) {
  if (!cell) return 0;
  const k = cell.kind, bi = cell.biome;
  if (k === 'air' || k === 'craft' || k === 'field' || k === 'nofly'
      || !bi || bi === 'water' || bi === 'parkland' || bi === 'badlands' || !cell.bt) return 0;
  const seed = (wx + 512) * 73 + (wy + 512) * 149;
  return floorHeight(cell, seed);
}

// Shared climb-out corridor test: a building dead ahead and low, right off the runway, is
// culled from the render entirely (see drawWorldObjects) so it never draws — and per the
// "must be visible to collide" rule, the CFIT sweep in cockpit.js skips the exact same tiles
// via this helper, so a building that isn't drawn can't hurt you either. f = forward distance,
// lat = lateral offset from the flight-path centerline (both in tile units), height = 0..1
// eye-height fraction. Returns false when the renderer would have culled it (corr <= 0).
// Capped to CLIMBOUT_MAX_F tiles ahead so this only shields the immediate runway departure —
// NOT any low pass elsewhere in the city, where buildings must render (and collide) normally.
// These three numbers are the ONLY place the corridor is defined — drawWorldObjects' soft
// edge-fade reuses them directly (see climbOutFade below) instead of a second hand-copied
// formula, so the render and the CFIT collision sweep can never drift out of sync again.
// 4.5 tiles covers a heavy/jet ground roll (Leviathan, Reaper) — a light Mayfly is airborne
// and climbing well inside this, so widening it doesn't cost the lighter craft anything.
export const CLIMBOUT_MAX_F = 4.5, CLIMBOUT_LAT_IN = 0.3, CLIMBOUT_LAT_OUT = 0.2;
// The renderer's own near/far visibility window (drawWorldObjects) — a building this close
// (about to pass under/behind you) or this far (still fading in) isn't really "on the glass"
// yet. Collision must never fire on a tile outside this window, or a hit can land on
// something the player couldn't actually have seen.
export const VISIBLE_NEAR_F = 0.05, VISIBLE_FAR_F = 20;   // long skyline — buildings draw out to 20 tiles and emerge from the horizon haze
export function climbOutClear(f, lat, height) {
  if (!(f > 0.1 && f < CLIMBOUT_MAX_F && height < 0.2)) return true;
  return clamp((Math.abs(lat) - CLIMBOUT_LAT_IN) / CLIMBOUT_LAT_OUT, 0, 1) > 0;
}
// The matching soft-edge fade (same corridor, same numbers) for the render's alpha ramp —
// only meaningful inside the same f/height window climbOutClear gates on.
function climbOutFade(lat) { return clamp((Math.abs(lat) - CLIMBOUT_LAT_IN) / CLIMBOUT_LAT_OUT, 0, 1); }

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
  const cx = W / 2, FL = (W / 2) / 1.15 * (RENDER_TUNE.fov || 1);   // fov<1 compresses the world laterally into a tighter tunnel
  const proj = (dx, dy, wz) => { const f = Math.max(0.06, dx * sinh - dy * cosh), l = dx * cosh + dy * sinh; return { sx: cx + (l / f) * FL, sy: horizonY + depth * (EH - wz) / f, f }; };
  const projFL = (aa, s, wz) => { const f = Math.max(0.06, aa); return { sx: cx + (s / f) * FL, sy: horizonY + depth * (EH - (wz || 0)) / f, f }; };
  return { R, sinh, cosh, ox, oy, proj, projFL, EH };   // EH exposed so airborne traffic can be placed relative to eye height
}

// One extruded, texture-mapped box between two heights (base wz0 → top wz1): painter-sorted
// walls + an optional roof. Setback towers stack several of these.
function draw3DBoxAt(ctx, cam, dx, dy, fh, wz0, wz1, biome, seed, night, alpha, roof) {
  fh = Math.min(fh, 0.48);   // keep a fat footprint inside its own tile (no bleed into the neighbour)
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

// ── Airport target guide ──────────────────────────────────────────────────────
// The one selected field (default: nearest; cycled with [ / ] or the radio) as either an
// in-view accent RING sitting on its spot on the ground, or — when it's off the forward view —
// a gold "Home" waypoint pinned to the edge that points the way to turn toward it. Projected
// through the same Mode-7 camera as the buildings, so the ring sits exactly where the field is.
// `v.apTarget = { dx, dy, name, dist }` — tile offset from the craft.
function drawAirportTarget(ctx, cam, v, W, H, now) {
  const ap = v.apTarget; if (!ap) return;
  const t = (now || 0) * 0.004, pulse = 0.6 + 0.4 * Math.sin(t);
  const p = cam.proj(ap.dx, ap.dy, 0);
  const onScreen = p.f > 0.12 && p.sx >= 10 && p.sx <= W - 10 && p.sy >= 10 && p.sy <= H - 10;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (onScreen) {
    // Accent ring on the field — grows as you close in, pulses so it's easy to find, with a
    // small inner ring, four edge ticks and the field name + distance above it.
    const r = clamp(46 / p.f, 11, 130);
    ctx.strokeStyle = `rgba(95,208,255,${0.55 + 0.45 * pulse})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, 7); ctx.stroke();
    ctx.strokeStyle = `rgba(95,208,255,${0.3 + 0.3 * pulse})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, r * 0.6, 0, 7); ctx.stroke();
    for (let a = 0; a < 4; a++) { const ang = a * Math.PI / 2; ctx.beginPath(); ctx.moveTo(p.sx + Math.cos(ang) * r, p.sy + Math.sin(ang) * r); ctx.lineTo(p.sx + Math.cos(ang) * (r + 6), p.sy + Math.sin(ang) * (r + 6)); ctx.stroke(); }
    ctx.fillStyle = '#bfe8ff'; ctx.font = 'bold 8px monospace';
    ctx.fillText((ap.name || 'FIELD').slice(0, 12).toUpperCase(), p.sx, p.sy - r - 11);
    ctx.font = '7px monospace'; ctx.fillStyle = '#7fc8ec';
    ctx.fillText(ap.dist + ' mi', p.sx, p.sy - r - 3);
    ctx.restore();
    return;
  }
  // Off-screen: a gold HOME waypoint pinned to the view edge, an arrow pointing the way to turn.
  const f = ap.dx * cam.sinh - ap.dy * cam.cosh, l = ap.dx * cam.cosh + ap.dy * cam.sinh;
  const cx = W / 2, cy = H * 0.46;
  let sx = l, sy = -f; const m = Math.hypot(sx, sy) || 1; sx /= m; sy /= m;   // screen dir: ahead → up
  const rad = Math.min(W, H) * 0.4;
  const ex = clamp(cx + sx * rad, 16, W - 16), ey = clamp(cy + sy * rad, 18, H - 16);
  ctx.translate(ex, ey);
  ctx.fillStyle = `rgba(255,207,62,${0.72 + 0.28 * pulse})`;
  ctx.save(); ctx.rotate(Math.atan2(sy, sx));   // arrow toward the field
  ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(5, -5); ctx.lineTo(5, 5); ctx.closePath(); ctx.fill();
  ctx.restore();
  // Little house glyph.
  ctx.beginPath(); ctx.moveTo(-6, 1); ctx.lineTo(0, -5); ctx.lineTo(6, 1); ctx.closePath(); ctx.fill();   // roof
  ctx.fillRect(-4, 1, 8, 6);                                                                                // body
  ctx.fillStyle = 'rgba(20,16,4,0.9)'; ctx.fillRect(-1.4, 3.5, 2.8, 3.5);                                   // door
  ctx.fillStyle = `rgba(255,215,110,${0.78 + 0.22 * pulse})`; ctx.font = 'bold 7px monospace';
  ctx.fillText((ap.name || 'FIELD').slice(0, 8).toUpperCase(), 0, -12);
  ctx.restore();
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

// Incoming ground-AA tracer — enters from below-and-toward the gun's bearing (relative to
// heading) and arcs up across the glass toward/past the cockpit, so fire from an emplacement
// you can't see is still visible and gives you a direction to break away from. `v.aaTracer`
// = { bearing, t } where t is 0..1 progress over the streak's short flight. At night the
// tracer round glows (a real tracer's phosphorus burns bright against a dark sky) — in
// daylight it's still visible but doesn't bloom.
function drawAATracer(ctx, W, H, v) {
  const tr = v.aaTracer; if (!tr) return;
  const rel = ((tr.bearing - (v.heading || 0) + 540) % 360) - 180;   // -180..180, 0 = dead ahead
  const edgeFrac = clamp(rel / 120, -1, 1);
  const enterX = W * (0.5 + edgeFrac * 0.68), enterY = H * 1.12;
  const exitX = W * (0.5 - edgeFrac * 0.5), exitY = -H * 0.18;   // arcs up and across as it passes
  const t = clamp(tr.t, 0, 1), ease = t * t * (3 - 2 * t);
  const hx = enterX + (exitX - enterX) * ease, hy = enterY + (exitY - enterY) * ease;
  const tailFrac = 0.22;
  const tx = enterX + (exitX - enterX) * Math.max(0, ease - tailFrac), ty = enterY + (exitY - enterY) * Math.max(0, ease - tailFrac);
  const night = v.sky?.night || 0;
  ctx.save(); ctx.lineCap = 'round';
  if (night > 0.3) { ctx.shadowColor = 'rgba(255,140,50,0.95)'; ctx.shadowBlur = 8 + night * 12; }
  const g = ctx.createLinearGradient(tx, ty, hx, hy);
  g.addColorStop(0, 'rgba(255,110,30,0)'); g.addColorStop(0.55, `rgba(255,150,60,${0.55 + night * 0.25})`); g.addColorStop(1, 'rgba(255,236,190,0.95)');
  ctx.strokeStyle = g; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.restore();
}
function cornerBox(ctx, cx, cy, r) {
  const k = r * 0.4;
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = cx + sx * r, y = cy + sy * r;
    ctx.moveTo(x, y); ctx.lineTo(x - sx * k, y); ctx.moveTo(x, y); ctx.lineTo(x, y - sy * k);
  }
  ctx.stroke();
}

// Solid, HARD-EDGED paved surfaces with painted markings, laid over the Mode-7 floor.
// Two kinds share the machinery: artery tiles render as a four-lane road (dashed lane
// dividers + solid double-yellow centre); airfield tiles (`kind:'field'`) render as pale
// airport-runway concrete (dashed white centreline + threshold "piano keys" where the
// strip ends). Both get an opaque fill (no faded texture wash) plus a crisp kerb line
// stroked along every boundary that meets a DIFFERENT surface — the hard edge, so the
// pavement never bleeds softly into the terrain. Markings run in WORLD space along the
// surface's direction, derived from which neighbours share the same surface (a N–S run
// marks along y, an E–W run along x; a crossing tile stays bare).
function drawGroundSurfaces(ctx, cam, v, sky = null, now = 0) {
  const map = v.map; if (!map || !map.length) return; const R = cam.R;
  const baseAlpha = ctx.globalAlpha;   // = worldBlend (set by the caller); the far fade rides on top of it
  const nite = sky ? sky.night : 0;
  const at = (rx, ry) => (ry >= 0 && ry < map.length && rx >= 0 && rx < map[ry].length) ? map[ry][rx] : null;
  const kindOf = (c) => !c ? null : c.kind === 'field' ? 'field' : c.road ? 'road' : null;   // an airfield tile paints as runway even if it also carries a road icon
  for (let ry = 0; ry < map.length; ry++) for (let rx = 0; rx < map[ry].length; rx++) {
    const c = map[ry][rx], surf = kindOf(c); if (!surf) continue;
    const dx = (rx - R) - cam.ox, dy = (ry - R) - cam.oy, f = dx * cam.sinh - dy * cam.cosh;
    if (f <= 0.06 || f > VISIBLE_FAR_F) continue;
    // Match the buildings' long draw distance + far fade so pavement ghosts up out of the
    // haze at the horizon instead of a hard line snapping in.
    ctx.globalAlpha = baseAlpha * clamp((VISIBLE_FAR_F - f) / 6, 0, 1);
    const corner = (sx, sy) => cam.proj(dx + sx * 0.5, dy + sy * 0.5, 0);
    const P0 = corner(-1, -1), P1 = corner(1, -1), P2 = corner(1, 1), P3 = corner(-1, 1);
    if ([P0, P1, P2, P3].some(p => p.f <= 0.05)) continue;
    // Solid fill — hard, opaque, no fade. Runway concrete reads a touch lighter than road tar.
    ctx.fillStyle = surf === 'field' ? '#3a3e46' : '#2b2f36';
    ctx.beginPath(); ctx.moveTo(P0.sx, P0.sy); ctx.lineTo(P1.sx, P1.sy); ctx.lineTo(P2.sx, P2.sy); ctx.lineTo(P3.sx, P3.sy); ctx.closePath(); ctx.fill();
    // Hard kerb edge: stroke each boundary that faces a non-matching surface.
    const nN = kindOf(at(rx, ry - 1)) === surf, nS = kindOf(at(rx, ry + 1)) === surf;
    const nW = kindOf(at(rx - 1, ry)) === surf, nE = kindOf(at(rx + 1, ry)) === surf;
    ctx.strokeStyle = surf === 'field' ? 'rgba(224,228,234,0.8)' : 'rgba(198,203,209,0.7)';
    ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    const edge = (a, b) => { ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); };
    if (!nN) edge(P0, P1); if (!nE) edge(P1, P2); if (!nS) edge(P3, P2); if (!nW) edge(P0, P3);
    // Direction from same-surface neighbours. Both axes = a crossing/apron → leave it bare.
    const ns = nN || nS, ew = nW || nE; if (ns && ew) continue;
    const A = ew && !ns ? [1, 0] : [0, 1];   // surface axis (default N–S for an isolated tile)
    const Px = A[1], Py = -A[0];             // across-surface axis
    const stripe = (off, hw, aLo, aHi, style) => {
      const q = (a, o) => cam.proj(dx + A[0] * a + Px * o, dy + A[1] * a + Py * o, 0);
      const c0 = q(aLo, off - hw), c1 = q(aLo, off + hw), c2 = q(aHi, off + hw), c3 = q(aHi, off - hw);
      if ([c0, c1, c2, c3].some(p => p.f <= 0.05)) return;
      ctx.fillStyle = style; ctx.beginPath();
      ctx.moveTo(c0.sx, c0.sy); ctx.lineTo(c1.sx, c1.sy); ctx.lineTo(c2.sx, c2.sy); ctx.lineTo(c3.sx, c3.sy); ctx.closePath(); ctx.fill();
    };
    const dashed = (off, hw, style) => { for (let a = -0.5; a < 0.5; a += 0.34) stripe(off, hw, a, Math.min(0.5, a + 0.2), style); };
    if (surf === 'field') {
      const WHITE = 'rgba(236,239,243,0.9)';
      dashed(0, 0.02, WHITE);                                    // dashed runway centreline
      stripe(-0.42, 0.016, -0.5, 0.5, WHITE); stripe(0.42, 0.016, -0.5, 0.5, WHITE);   // runway edge lines
      // Threshold "piano keys" across each end where the runway stops (neighbour is not runway).
      for (const [open, end] of [[A[0] ? nW : nN, -1], [A[0] ? nE : nS, 1]]) {
        if (open) continue;                                      // interior tile — no threshold here
        for (let k = -3; k <= 3; k++) stripe(k * 0.11, 0.035, end * 0.5, end * 0.36, WHITE);
      }
      // Glowing edge lights at night — a bright bead at each edge line, both ends of the tile.
      if (nite > 0.25) {
        const light = (a, o) => { const p = cam.proj(dx + A[0] * a + Px * o, dy + A[1] * a + Py * o, 0); if (p.f <= 0.06) return; ctx.fillStyle = `rgba(255,246,214,${0.95 * nite})`; ctx.beginPath(); ctx.arc(p.sx, p.sy, clamp(2.2 / p.f, 0.8, 3.4), 0, 7); ctx.fill(); };
        for (const a of [-0.5, 0]) { light(a, -0.44); light(a, 0.44); }
      }
    } else {
      const LANE = 'rgba(232,234,238,0.8)', YEL = 'rgba(230,200,74,0.9)';
      dashed(-0.23, 0.014, LANE); dashed(0.23, 0.014, LANE);                          // lane dividers
      stripe(-0.045, 0.014, -0.5, 0.5, YEL); stripe(0.045, 0.014, -0.5, 0.5, YEL);    // double-yellow centre
    }
  }
}

// Departure runway anchored in the WORLD (origin + heading), projected through the same
// camera as the buildings — so it stays put on the ground and recedes/rotates as you fly
// away instead of tracking the nose. `rw = { ox, oy, hdg, alt }` = the runway origin's
// world offset from the craft (tiles), its heading, and the climb-fade level.
function drawRunwayTex(ctx, cam, v, outerFade = 1, sky = null, now = 0) {
  const rw = v.runway; if (!rw) return;
  const alt = clamp(rw.alt || 0, 0, 1);
  const RWL = rw.len || RENDER_TUNE.rwl, hw = 0.15, BACK = 0.6, fMin = 0.06;
  const fade = clamp(1.4 - alt * 1.5, 0, 1) * outerFade; if (fade <= 0.02) return;
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
  // Night lighting: edge lights, green threshold / red end bar, and the approach rabbit.
  if (sky && sky.night > 0.25) drawRunwayLights(ctx, P, tLo, tHi, hw, now, fade * sky.night);
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

// ── Dedicated per-building models ─────────────────────────────────────────────
// Every named building on the 1:1 map gets its OWN model here — a type-appropriate
// silhouette (a precinct reads as a precinct, the clinic wears a red cross, the TV
// studio carries an antenna mast + dish, the power plant vents from cooling towers)
// plus a per-building palette/neon so no two buildings — even two of the same type —
// ever share a look. Keyed by a slug of the building's name (shipped as `bn` in the
// map window). A building not in this table falls through to the type/biome archetype
// path in drawWorldObjects, so a new or un-modelled building still renders something.
// Height comes from bldgStyle() (the value the CFIT sweep reads), so the mass you see
// is the mass you can hit; the per-building distinctiveness lives in the footprint,
// palette and rooftop adornments — exactly the parts the collision sweep ignores.
function bldgSlug(name) { return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
const NAMED_MODELS = {
  halcyontowers:                  { type: 'office',    pal: 'ty_office' },
  embassyhotelbar:                { type: 'embassy',   pal: 'ty_embassy',  neon: '#ff4a9a' },
  chromecourt:                    { type: 'apartment', pal: 'ty_apt_a' },
  themeridianlobby:               { type: 'apartment', pal: 'ty_apt_b',    penthouse: true },
  precinct9:                      { type: 'police',    pal: 'ty_police' },
  coldwaterclonefacility:         { type: 'clone',     pal: 'ty_clone' },
  ksabtvstudiostage:              { type: 'studio',    pal: 'ty_studio' },
  coldwaterpowerplantturbinehall: { type: 'power',     pal: 'ty_power' },
  coldwaterregionalhangar:        { type: 'hangar',    pal: 'ty_hangar_a', big: true },
  thresholdhelipadhangar:         { type: 'hangar',    pal: 'ty_hangar_b', helipad: true },
  sump:                           { type: 'bar',       pal: 'ty_bar_a',    neon: '#7dff6a' },
  thedeadpigeon:                  { type: 'bar',       pal: 'ty_bar_b',    neon: '#5fd0ff' },
  thecherrypit:                   { type: 'club',      pal: 'ty_club',     neon: '#ff4a9a' },
  rationnine:                     { type: 'diner',     pal: 'ty_diner',    neon: '#ffcf3e' },
  ampersandelectronics:           { type: 'shop',      pal: 'ty_shop_a',   neon: '#5fd0ff' },
  deadspaceinteriors:             { type: 'shop',      pal: 'ty_shop_b',   neon: '#7dff6a' },
  secondskin:                     { type: 'shop',      pal: 'ty_shop_c',   neon: '#ff4a9a' },
  thecage:                        { type: 'shop',      pal: 'ty_shop_d',   neon: '#ffcf3e' },
  velkspreownedfurnishings:       { type: 'shop',      pal: 'ty_shop_e',   neon: '#ff8a4a' },
};
function namedModel(name) { return NAMED_MODELS[bldgSlug(name)] || null; }

// Per-type default model, so a building that carries only a building_type (no bespoke
// NAMED_MODELS entry yet — a freshly-authored one) still renders a type-appropriate
// dedicated model instead of a borrowed biome archetype. modelFor() prefers the named
// model, then the type default; a tile with neither (a plain street/park tile) returns
// null and keeps its biome archetype.
const TYPE_MODEL = {
  corporate_office: { type: 'office',    pal: 'ty_office' },
  hotel:            { type: 'hotel',     pal: 'ty_hotel',  neon: '#ff4a9a' },
  apartment:        { type: 'apartment', pal: 'ty_apt_a' },
  residential:      { type: 'apartment', pal: 'ty_apt_b' },
  shop:             { type: 'shop',      pal: 'ty_shop_a', neon: '#5fd0ff' },
  diner:            { type: 'diner',     pal: 'ty_diner',  neon: '#ffcf3e' },
  bar:              { type: 'bar',       pal: 'ty_bar_a',  neon: '#7dff6a' },
  club:             { type: 'club',      pal: 'ty_club',   neon: '#ff4a9a' },
  studio:           { type: 'studio',    pal: 'ty_studio' },
  police:           { type: 'police',    pal: 'ty_police' },
  clinic:           { type: 'clinic',    pal: 'ty_clinic' },
  power:            { type: 'power',     pal: 'ty_power' },
  hangar:           { type: 'hangar',    pal: 'ty_hangar_a' },
};
function modelFor(cell) { return (cell.bn && namedModel(cell.bn)) || (cell.bt && TYPE_MODEL[cell.bt]) || null; }

// Shared adornment primitives for the dedicated models (all project through the same camera).
function blinkLight(ctx, cam, dx, dy, wz, rgb, now, seed, alpha, r = 1.6) {
  const p = cam.proj(dx, dy, wz); if (p.f <= 0.1) return;
  const k = 0.4 + 0.5 * Math.abs(Math.sin((now || 0) * 0.004 + seed));
  ctx.globalAlpha = alpha; ctx.fillStyle = `rgba(${rgb},${k})`;
  ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
}
function mast(ctx, cam, dx, dy, h0, h1, alpha, now, seed) {   // guyed antenna mast + red aviation light
  const a = cam.proj(dx, dy, h0), b = cam.proj(dx, dy, h1);
  if (a.f > 0.1 && b.f > 0.1) {
    ctx.globalAlpha = alpha; ctx.strokeStyle = 'rgba(184,192,206,0.8)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); ctx.globalAlpha = 1;
  }
  blinkLight(ctx, cam, dx, dy, h1, '255,80,80', now, seed, alpha);
}
function dish(ctx, cam, dx, dy, wz, s0, alpha) {   // rooftop satellite dish
  const p = cam.proj(dx, dy, wz); if (p.f <= 0.1) return; const r = clamp(s0 / p.f, 2, 22);
  ctx.globalAlpha = alpha; ctx.fillStyle = 'rgba(198,204,214,0.85)';
  ctx.beginPath(); ctx.ellipse(p.sx, p.sy, r, r * 0.5, -0.5, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
}
function crossMark(ctx, cam, dx, dy, wz, alpha) {   // red medical cross billboard
  const p = cam.proj(dx, dy, wz); if (p.f <= 0.1) return; const s = clamp(9 / p.f, 2, 16);
  ctx.globalAlpha = alpha; ctx.fillStyle = 'rgba(230,60,60,0.95)';
  ctx.fillRect(p.sx - s * 0.28, p.sy - s, s * 0.56, s * 2);
  ctx.fillRect(p.sx - s, p.sy - s * 0.28, s * 2, s * 0.56); ctx.globalAlpha = 1;
}
function neonBlade(ctx, cam, dx, dy, h0, h1, color, night, alpha) {   // vertical neon sign (generalised marquee)
  const b = cam.proj(dx, dy, h0), t = cam.proj(dx, dy, h1); if (b.f <= 0.12 || t.f <= 0.12) return;
  ctx.globalAlpha = alpha * (night ? 0.95 : 0.55); ctx.strokeStyle = color; ctx.lineWidth = 2.4;
  if (night) { ctx.shadowColor = color; ctx.shadowBlur = 7; }
  ctx.beginPath(); ctx.moveTo(b.sx, b.sy); ctx.lineTo(t.sx, t.sy); ctx.stroke();
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
}
function glowPool(ctx, cam, dx, dy, wz, rgb, s0, alpha) {   // soft ground/roof glow (generalised ruin glow)
  const g = cam.proj(dx, dy, wz); if (g.f <= 0.12) return; const s = clamp(s0 / g.f, 3, 60);
  const rg = ctx.createRadialGradient(g.sx, g.sy, 1, g.sx, g.sy, s);
  rg.addColorStop(0, `rgba(${rgb},${alpha})`); rg.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(g.sx, g.sy, s, 0, 7); ctx.fill();
}
// A HORIZONTAL neon sign band across a building's entrance face (a hotel/bar marquee), at
// height wz, spanning ±half across the front edge (E = entrance world vector).
function marqueeBand(ctx, cam, dx, dy, E, half, wz, color, night, alpha) {
  const px = E[1] * half, py = -E[0] * half;          // across-front half-width
  const ox = E[0] * half * 0.92, oy = E[1] * half * 0.92;   // pushed out to the front face
  const a = cam.proj(dx - px + ox, dy - py + oy, wz), b = cam.proj(dx + px + ox, dy + py + oy, wz);
  if (a.f <= 0.12 || b.f <= 0.12) return;
  ctx.globalAlpha = alpha * (night ? 1 : 0.6); ctx.strokeStyle = color; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
  if (night) { ctx.shadowColor = color; ctx.shadowBlur = 9; }
  ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
  ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.lineCap = 'butt';
}

// ── Entrance facing ───────────────────────────────────────────────────────────
// A model is authored with its FRONT (door, awning, marquee, forecourt) on its local
// +y axis. faceVec turns the server's entrance direction into that front's world
// heading; facePt rotates a model-local offset (lx,ly) onto the world so the door band
// swings around to the street the building actually opens onto. Local +x maps to the
// perpendicular (right of the door), local +y to the entrance vector.
function faceVec(ent) {
  switch (ent) {
    case 'north': return [0, -1];
    case 'south': return [0, 1];
    case 'east':  return [1, 0];
    case 'west':  return [-1, 0];
    default:      return [0, 1];   // unknown → keep the old front-facing default
  }
}
function facePt(dx, dy, lx, ly, E) {
  const px = E[1], py = -E[0];   // local +x = right of the door (E rotated -90°)
  return [dx + lx * px + ly * E[0], dy + lx * py + ly * E[1]];
}

// A dedicated named-building model: a type-appropriate silhouette built from draw3DBoxAt +
// the adornments above, coloured by the building's own palette (m.pal) and neon (m.neon).
// `E` is the entrance world-vector (faceVec) so the door/forecourt points at the street.
function drawTypeModel(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E = [0, 1]) {
  const pal = m.pal;
  const F = (lx, ly) => facePt(dx, dy, lx, ly, E);   // model-local → world, rotated to the entrance
  switch (m.type) {
    case 'office': {   // corporate glass tower: three setbacks + spire beacon
      let w = fh * 1.1, z = 0; const H = h * 1.7;
      for (let i = 0; i < 3; i++) { const z1 = H * ((i + 1) / 3); draw3DBoxAt(ctx, cam, dx, dy, w, z, z1, pal, seed + i, night, alpha, true); z = z1; w *= 0.74; }
      mast(ctx, cam, dx, dy, H, H + h * 0.5, alpha, now, seed);
      break;
    }
    case 'hotel': {   // podium + tall guest slab + entrance marquee + vertical neon blade
      const neon = m.neon || '#ff4a9a';
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.2, 0, h * 0.24, pal, seed + 4, night, alpha, true);        // lit ground-floor podium
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.0, h * 0.24, h * 1.4, pal, seed, night, alpha, true);      // guest tower
      { const [cx, cy] = F(0, fh * 1.02); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.85, h * 0.16, h * 0.24, 'ty_door', seed + 5, night, alpha, false); }   // porte-cochère canopy over the entrance
      marqueeBand(ctx, cam, dx, dy, E, fh, h * 0.27, neon, night, alpha);                             // marquee sign across the front
      { const [nx, ny] = F(-fh * 0.55, fh * 0.55); neonBlade(ctx, cam, nx, ny, h * 0.3, h * 1.35, neon, night, alpha); }
      if (night) glowPool(ctx, cam, dx, dy, h * 1.4, '255,120,180', 20, alpha * 0.2);
      break;
    }
    case 'embassy': {   // Embassy Hotel & Bar: warm guest tower over a moody neon bar podium + big marquee
      const neon = m.neon || '#ff4a9a';
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.32, 0, h * 0.34, 'ty_embassy_bar', seed + 4, night, alpha, true);   // wide street-level bar
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, h * 0.34, h * 1.55, pal, seed, night, alpha, true);             // hotel tower above
      { const [cx, cy] = F(0, fh * 1.15); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.95, h * 0.2, h * 0.3, 'ty_door', seed + 5, night, alpha, false); }   // grand entrance canopy
      marqueeBand(ctx, cam, dx, dy, E, fh * 1.25, h * 0.16, '#ffcf3e', night, alpha);      // gold bar marquee low across the front
      marqueeBand(ctx, cam, dx, dy, E, fh, h * 0.36, neon, night, alpha);                  // pink hotel marquee above the podium
      { const [nx, ny] = F(-fh * 0.62, fh * 0.6); neonBlade(ctx, cam, nx, ny, h * 0.36, h * 1.5, neon, night, alpha); }   // vertical HOTEL blade up the corner
      if (night) {
        glowPool(ctx, cam, dx, dy, h * 0.34, '255,190,90', 26, alpha * 0.32);             // warm bar spill at street level
        glowPool(ctx, cam, dx, dy, h * 1.55, '255,120,180', 16, alpha * 0.18);            // rooftop sign glow
      }
      blinkLight(ctx, cam, dx, dy, h * 1.55, '255,90,160', now, seed, alpha, 1.7);
      break;
    }
    case 'clone': {   // Coldwater Clone Facility: clean lab shell, glowing bio-vats, a reactor dome + vents
      const bio = '90,255,200';
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.18, 0, h * 0.8, pal, seed, night, alpha, true);            // clinical main block
      { const [sx, sy] = F(-fh * 0.32, 0); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.5, h * 0.8, h * 1.15, pal, seed + 1, night, alpha, true); }   // set-back upper lab
      // Row of lit clone-vat cylinders along the front face — the science-y signature.
      for (const s of [-0.75, -0.25, 0.25, 0.75]) {
        const [vx, vy] = F(s * fh * 0.78, fh * 0.62);
        draw3DBoxAt(ctx, cam, vx, vy, fh * 0.13, 0, h * 0.52, 'ty_clone_vat', seed + 12 + Math.round(s * 4), night, alpha, true);
        glowPool(ctx, cam, vx, vy, h * 0.26, bio, 7, alpha * (night ? 0.55 : 0.34));      // green bio-glow inside each tank
      }
      // Reactor / clean-room dome glow on the roof, venting steam, hazard beacon + antenna.
      glowPool(ctx, cam, dx, dy, h * 0.86, '120,255,220', 22, alpha * (night ? 0.42 : 0.24));
      { const [wx2, wy2] = F(fh * 0.72, -fh * 0.2); drawSmoke(ctx, cam, wx2, wy2, h * 0.8, '206,232,226', alpha * 0.6, now, seed + 2); }
      { const [mx, my] = F(-fh * 0.9, -fh * 0.2); mast(ctx, cam, mx, my, h * 0.8, h * 1.55, alpha, now, seed + 4); }
      blinkLight(ctx, cam, dx, dy, h * 1.15, bio, now, seed, alpha, 2);
      break;
    }
    case 'apartment': {   // podium + residential block + optional penthouse
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.3, 0, h * 0.28, pal, seed + 5, night, alpha, true);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.0, h * 0.28, h, pal, seed, night, alpha, true);
      if (m.penthouse) { const [px, py] = F(fh * 0.3, 0); draw3DBoxAt(ctx, cam, px, py, fh * 0.5, h, h * 1.16, pal, seed + 2, night, alpha, true); }
      break;
    }
    case 'police': {   // squat wide civic block + set-back roof house + blue beacon + antenna
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.4, 0, h * 0.85, pal, seed, night, alpha, true);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.7, h * 0.85, h * 0.98, pal, seed + 1, night, alpha, true);
      { const [mx, my] = F(fh * 0.9, 0); mast(ctx, cam, mx, my, h * 0.85, h * 1.5, alpha, now, seed + 3); }
      { const [bx, by] = F(-fh * 0.7, 0); blinkLight(ctx, cam, bx, by, h, '90,150,255', now, seed, alpha, 1.8); }
      break;
    }
    case 'clinic': {   // clean pale block + rooftop red cross + soft clone-vat glow
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.2, 0, h * 0.9, pal, seed, night, alpha, true);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.55, h * 0.9, h * 1.08, pal, seed + 1, night, alpha, true);
      crossMark(ctx, cam, dx, dy, h * 1.2, alpha);
      glowPool(ctx, cam, dx, dy, h * 0.4, '120,220,150', 16, alpha * (night ? 0.28 : 0.14));
      break;
    }
    case 'studio': {   // broad low studio block + tall guyed mast + satellite dish
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.45, 0, h * 0.7, pal, seed, night, alpha, true);
      { const [mx, my] = F(-fh * 0.7, 0); mast(ctx, cam, mx, my, h * 0.7, h * 2.1, alpha, now, seed + 2); }
      { const [ex, ey] = F(fh * 0.7, 0); dish(ctx, cam, ex, ey, h * 0.72, 10, alpha); }
      break;
    }
    case 'hangar': {   // wide low shed + big dark door band + ATC control tower (+ helipad glow)
      const w = fh * (m.big ? 1.7 : 1.4), top = h * (m.big ? 0.7 : 0.6);
      draw3DBoxAt(ctx, cam, dx, dy, w, 0, top, pal, seed, night, alpha, true);
      { const [gx, gy] = F(0, w * 0.55); draw3DBoxAt(ctx, cam, gx, gy, w * 0.7, 0, top * 0.62, 'ty_door', seed + 1, night, alpha, false); }   // hangar door faces the street/apron
      // Control tower off one corner of the apron: a slender shaft topped by a wider glazed
      // cab and an alternating aviation beacon — so a hangar reads as a working airfield, not
      // just a shed. Like the masts on other models, it stands above the collision box.
      const [txx, txy] = F(-w * 0.95, -w * 0.2);
      const cabTop = h * (m.big ? 1.9 : 1.55), cabBot = cabTop * 0.82;
      draw3DBoxAt(ctx, cam, txx, txy, fh * 0.24, 0, cabBot, pal, seed + 4, night, alpha, false);
      draw3DBoxAt(ctx, cam, txx, txy, fh * 0.5, cabBot, cabTop, 'ty_office', seed + 5, night, alpha, true);
      if (night) glowPool(ctx, cam, txx, txy, cabTop * 0.92, '150,210,255', 9, alpha * 0.3);
      blinkLight(ctx, cam, txx, txy, cabTop + h * 0.06, '150,255,170', now, seed + 6, alpha, 1.9);
      if (m.helipad) glowPool(ctx, cam, dx, dy, top + 0.01, '255,210,90', 14, alpha * 0.3);
      break;
    }
    case 'power': {   // twin cooling towers venting steam + a tall smokestack
      for (const s of [-1, 1]) {
        const [cx, cy] = F(s * fh * 0.8, 0);
        draw3DBoxAt(ctx, cam, cx, cy, fh * 0.7, 0, h * 0.5, pal, seed + s + 1, night, alpha, false);
        draw3DBoxAt(ctx, cam, cx, cy, fh * 0.55, h * 0.5, h * 1.05, pal, seed + s + 1, night, alpha, true);
        drawSmoke(ctx, cam, cx, cy, h * 1.05, '210,214,220', alpha * 0.8, now, seed + s + 1);
      }
      { const [sx, sy] = F(0, -fh * 0.6);
        draw3DBoxAt(ctx, cam, sx, sy, fh * 0.3, 0, h * 1.7, pal, seed + 4, night, alpha, true);
        drawSmoke(ctx, cam, sx, sy, h * 1.7, '72,66,60', alpha, now, seed + 4);
        blinkLight(ctx, cam, sx, sy, h * 1.7, '255,80,80', now, seed, alpha); }
      break;
    }
    case 'bar': {   // small box + a neon blade
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.95, 0, h * 0.7, pal, seed, night, alpha, true);
      neonBlade(ctx, cam, dx, dy, h * 0.7, h * 1.05, m.neon || '#5fd0ff', night, alpha);
      break;
    }
    case 'club': {   // box + twin neon roofline + colour glow
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.05, 0, h * 0.8, pal, seed, night, alpha, true);
      { const [ax, ay] = F(-fh * 0.4, 0); neonBlade(ctx, cam, ax, ay, h * 0.8, h * 1.15, m.neon || '#ff4a9a', night, alpha); }
      { const [bx, by] = F(fh * 0.4, 0); neonBlade(ctx, cam, bx, by, h * 0.8, h * 1.15, m.neon || '#ff4a9a', night, alpha); }
      glowPool(ctx, cam, dx, dy, h * 0.85, '255,74,154', 20, alpha * (night ? 0.34 : 0.16));
      break;
    }
    case 'diner': {   // small warm box + rooftop neon + window glow
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.05, 0, h * 0.6, pal, seed, night, alpha, true);
      neonBlade(ctx, cam, dx, dy, h * 0.6, h * 0.92, m.neon || '#ffcf3e', night, alpha);
      if (night) glowPool(ctx, cam, dx, dy, h * 0.3, '255,200,120', 12, alpha * 0.2);
      break;
    }
    case 'shop':
    default: {   // low storefront + awning band + a small sign
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.15, 0, h * 0.7, pal, seed, night, alpha, true);
      { const [gx, gy] = F(0, fh * 0.9); draw3DBoxAt(ctx, cam, gx, gy, fh * 1.15, h * 0.12, h * 0.2, 'ty_door', seed + 1, night, alpha, false); }   // storefront awning faces the street
      neonBlade(ctx, cam, dx, dy, h * 0.7, h * 0.95, m.neon || '#5fd0ff', night, alpha);
      break;
    }
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
function drawWorldObjects(ctx, cam, v, sky, now, sun) {
  const map = v.map; if (!map || !map.length) return; const R = cam.R, night = sky.night;
  const FAR = VISIBLE_FAR_F, wcx = v.mapCenter ? v.mapCenter.x : 0, wcy = v.mapCenter ? v.mapCenter.y : 0;
  const items = [];
  for (let ry = 0; ry < map.length; ry++) for (let rx = 0; rx < map[ry].length; rx++) {
    const c = map[ry][rx]; if (!c || c.kind === 'air' || c.kind === 'craft' || c.kind === 'field' || c.biome === 'water') continue;
    const dx = (rx - R) - cam.ox, dy = (ry - R) - cam.oy, f = dx * cam.sinh - dy * cam.cosh;
    if (f <= VISIBLE_NEAR_F || f > FAR) continue;
    const lat = dx * cam.cosh + dy * cam.sinh;
    let alpha = clamp((f - 0.06) / 0.4, 0, 1) * clamp((FAR - f) / 6, 0, 1) * (v.worldBlend ?? 1);   // near pass-under + a LONG far fade-in (6 tiles) so distant buildings ghost up out of the haze instead of popping
    // Keep the CLIMB-OUT path ahead clear (a building dead ahead reads as something
    // you'd fly into right off the runway) — but only while still low/climbing AND only
    // within CLIMBOUT_MAX_F tiles of the departure (see climbOutClear). Once past that
    // window OR settled into cruise, buildings ahead stay fully visible; this is a takeoff
    // flourish, not a permanent no-fly corridor. Gated identically to (and reusing the same
    // numbers as) the CFIT collision sweep in cockpit.js, so nothing can go invisible here
    // while still being solid there, or vice versa.
    if (f > 0.1 && f < CLIMBOUT_MAX_F && (v.height || 0) < 0.2) {
      if (!climbOutClear(f, lat, v.height || 0)) continue;
      alpha *= climbOutFade(lat);
    }
    if (alpha <= 0.02) continue;
    // Seed from the WORLD tile (stable), NOT the array index — so a building keeps its shape
    // when the server recenters the map window (was the main "popping in and out" cause).
    const wx = Math.round((rx - R) + wcx), wy = Math.round((ry - R) + wcy);
    items.push({ dx, dy, f, c, alpha, seed: (wx + 512) * 73 + (wy + 512) * 149 });   // stable, positive, frac-friendly
  }
  items.sort((a, b) => b.f - a.f);
  // Shadow pre-pass: lay every building's ground shadow FIRST (far→near) so the bodies drawn
  // next sit on top of the whole shadow field instead of over-painting a neighbour's shadow.
  if (sun && sun.len > 0) {
    for (const it of items) {
      if (!it.c.bt) continue;
      const h = floorHeight(it.c, it.seed);
      const fh = (BUILDING_FOOT + frac(it.seed + 2) * 0.06) * RENDER_TUNE.bldgFoot;
      drawBuildingShadow(ctx, cam, it.dx, it.dy, fh, h, sun, it.alpha);
    }
  }
  for (const it of items) {
    const alpha = it.alpha, bi = it.c.biome;
    if (it.c.kind === 'nofly') { draw3DBox(ctx, cam, it.dx, it.dy, 0.3, 0.55, '__nofly', it.seed, night, alpha * 0.7); continue; }
    if (bi === 'parkland') { drawTreeBB(ctx, cam, it.dx, it.dy, night, it.seed, alpha); continue; }
    if (bi === 'badlands') { if ((it.seed % 3) === 0) drawRockBB(ctx, cam, it.dx, it.dy, night, it.seed, alpha); continue; }
    // Only a real building tile (has `bt`) extrudes a 3-D building — a plain terrain tile
    // stays bare ground, never sprouts a generated building. Matches buildingHeightZ, so
    // what you see is exactly what you can hit.
    if (!it.c.bt) continue;
    // Height comes from the building's storeys (floorHeight) — the SAME formula the CFIT
    // sweep reads — so what you see is exactly what you can hit. Footprint fills most of the
    // tile (a building occupies its whole zone, not a dot in the middle).
    const { arch } = bldgStyle(it.c);
    const h = floorHeight(it.c, it.seed);
    const fh = (BUILDING_FOOT + frac(it.seed + 2) * 0.06) * RENDER_TUNE.bldgFoot;
    const face = faceVec(it.c.ent);   // door side → the street the entrance opens onto
    // Every building draws a dedicated model (its own if named, else its type default) at
    // the same mass; a non-building tile falls back to the shared biome archetype set
    // (industrial stacks, freight containers, cooling towers, broken ruins, neon marquee, …).
    const m = modelFor(it.c);
    if (m) drawTypeModel(ctx, cam, it.dx, it.dy, fh, h, m, it.seed, night, alpha, now, face);
    else drawBuilding(ctx, cam, it.dx, it.dy, fh, h, arch, it.seed, night, alpha, now);
    // Rooftop holo-ad: a flickering translucent sign floating over ~1 in 4 tall-ish city
    // buildings at night — post-singularity advertising, half its pixels dead.
    if (night > 0.3 && h > 0.35 && (it.seed % 4) === 0) drawHoloAd(ctx, cam, it.dx, it.dy, fh, h, it.seed, now, alpha * night);
  }
}

// A building's ground shadow: a soft parallelogram beam of width = the footprint, cast in
// the sun's shadow direction and lengthened as the building is taller / the sun sits lower.
function drawBuildingShadow(ctx, cam, dx, dy, fh, h, sun, alpha) {
  const sd = sun.shadowDir, L = clamp(h * sun.len, 0.15, 3.5);
  const px = -sd[1] * fh, py = sd[0] * fh;   // half-width perpendicular to the shadow direction
  const A = cam.proj(dx - px, dy - py, 0), B = cam.proj(dx + px, dy + py, 0);
  const C = cam.proj(dx + px + sd[0] * L, dy + py + sd[1] * L, 0), D = cam.proj(dx - px + sd[0] * L, dy - py + sd[1] * L, 0);
  if ([A, B, C, D].some((p) => p.f <= 0.06)) return;
  ctx.fillStyle = `rgba(8,10,14,${clamp(sun.alpha * alpha, 0, 0.4)})`;
  ctx.beginPath(); ctx.moveTo(A.sx, A.sy); ctx.lineTo(B.sx, B.sy); ctx.lineTo(C.sx, C.sy); ctx.lineTo(D.sx, D.sy); ctx.closePath(); ctx.fill();
}

// The aircraft's own shadow on the ground — a dark ellipse at the point the sun projects the
// craft down onto, sliding away and shrinking with altitude. Reads as a height cue on a low,
// sun-behind pass; naturally culled (off the bottom / behind) when it wouldn't be visible.
function drawAircraftShadow(ctx, cam, height, sun, worldBlend) {
  const sd = sun.shadowDir, alt = clamp(height, 0, 1);
  const reach = alt * 6 / Math.max(0.25, sun.elev);
  const p = cam.proj(sd[0] * reach, sd[1] * reach, 0);
  if (p.f <= 0.12 || p.f > VISIBLE_FAR_F) return;
  const size = clamp(26 / p.f, 3, 60) * (1 - alt * 0.4);
  ctx.save();
  ctx.globalAlpha = clamp(sun.alpha * 1.4 * worldBlend * (1 - alt * 0.5), 0, 0.4);
  ctx.fillStyle = 'rgb(6,8,12)';
  ctx.beginPath(); ctx.ellipse(p.sx, p.sy, size, size * 0.42, 0, 0, 7); ctx.fill();
  ctx.restore();
}

const HOLO_COLS = ['90,200,255', '255,90,160', '120,255,140', '255,200,80', '180,120,255'];
// A rooftop holographic advertising panel: a translucent coloured pane floating above the
// roof with scanline bars, stuttering and dropping frames (half its pixels dead).
function drawHoloAd(ctx, cam, dx, dy, fh, h, seed, now, alpha) {
  const col = HOLO_COLS[seed % HOLO_COLS.length];
  const z0 = h * 1.03, z1 = h * (1.28 + frac(seed) * 0.18), w = fh * (0.7 + frac(seed + 1) * 0.5);
  const b0 = cam.proj(dx - w, dy, z0), b1 = cam.proj(dx + w, dy, z0), t1 = cam.proj(dx + w, dy, z1), t0 = cam.proj(dx - w, dy, z1);
  if ([b0, b1, t1, t0].some((p) => p.f <= 0.12)) return;
  const dropped = frac(Math.floor(now * 0.018) + seed) < 0.16;   // some frames blink out entirely
  const flick = (0.45 + 0.55 * Math.abs(Math.sin(now * 0.006 + seed))) * (dropped ? 0.15 : 1);
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.fillStyle = `rgba(${col},${0.16 * flick})`;
  ctx.beginPath(); ctx.moveTo(t0.sx, t0.sy); ctx.lineTo(t1.sx, t1.sy); ctx.lineTo(b1.sx, b1.sy); ctx.lineTo(b0.sx, b0.sy); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = `rgba(${col},${0.5 * flick})`; ctx.lineWidth = 1;
  for (let k = 1; k < 4; k++) {
    const tt = k / 4;
    const lx = t0.sx + (b0.sx - t0.sx) * tt, ly = t0.sy + (b0.sy - t0.sy) * tt;
    const rx = t1.sx + (b1.sx - t1.sx) * tt, ry = t1.sy + (b1.sy - t1.sy) * tt;
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(rx, ry); ctx.stroke();
  }
  ctx.restore();
}

// Sweeping surveillance searchlights rising off restricted (no-fly) blocks at night — a beam
// that leans as it sweeps, doubling as a "keep out" telegraph. Capped so a dense border of
// no-fly tiles can't spam beams.
function drawSearchlights(ctx, cam, v, now, worldBlend) {
  const map = v.map; if (!map || !map.length) return; const R = cam.R;
  ctx.save(); ctx.lineCap = 'round'; let n = 0;
  for (let ry = 0; ry < map.length && n < 6; ry++) for (let rx = 0; rx < map[ry].length && n < 6; rx++) {
    const c = map[ry][rx]; if (!c || c.kind !== 'nofly') continue;
    const dx = (rx - R) - cam.ox, dy = (ry - R) - cam.oy, f = dx * cam.sinh - dy * cam.cosh;
    if (f <= 0.2 || f > VISIBLE_FAR_F) continue;
    n++;
    const seed = rx * 7 + ry * 13, sweep = Math.sin(now * 0.0011 + seed);
    const base = cam.proj(dx, dy, 0.02), tip = cam.proj(dx + sweep * 0.5, dy, 1.3 + 0.6 * (0.5 + 0.5 * Math.sin(now * 0.002 + seed)));
    if (base.f <= 0.12 || tip.f <= 0.12) continue;
    const a = clamp((VISIBLE_FAR_F - f) / 6, 0, 1) * 0.5 * worldBlend;
    const g = ctx.createLinearGradient(base.sx, base.sy, tip.sx, tip.sy);
    g.addColorStop(0, `rgba(150,205,255,${a})`); g.addColorStop(1, 'rgba(150,205,255,0)');
    ctx.strokeStyle = g; ctx.lineWidth = clamp(10 / f, 2, 14);
    ctx.beginPath(); ctx.moveTo(base.sx, base.sy); ctx.lineTo(tip.sx, tip.sy); ctx.stroke();
    ctx.fillStyle = `rgba(210,235,255,${clamp(a * 1.5, 0, 0.8)})`;
    ctx.beginPath(); ctx.arc(base.sx, base.sy, clamp(4 / f, 1, 4), 0, 7); ctx.fill();
  }
  ctx.restore();
}

// Ambient flock: a handful of billboard birds drifting across the mid-sky that scatter —
// speed up and climb — as the aircraft bears down on them. Daytime, airborne only.
function drawBirds(ctx, W, H, horizonY, v, st, dt, speed, sky, now, worldBlend) {
  if (worldBlend < 0.3 || sky.night > 0.6) return;
  if (!st.birds) st.birds = Array.from({ length: 6 }, (_, i) => ({ x: frac(i * 3.1), y: 0.15 + frac(i * 5.7) * 0.4, ph: frac(i * 2.3) * 6, sp: 0.4 + frac(i) * 0.5, scat: 0 }));
  ctx.save(); ctx.strokeStyle = `rgba(18,22,28,${0.5 * worldBlend})`; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
  for (const b of st.birds) {
    const near = clamp(1 - Math.abs(b.x - 0.5) * 3, 0, 1);
    b.scat += ((speed > 0.2 && near > 0.4 ? 1 : 0) - b.scat) * Math.min(1, dt * 2);
    b.x = (b.x + (0.02 + speed * 0.06 + b.scat * 0.2) * b.sp * dt) % 1.15;
    b.ph += dt * (6 + b.scat * 10);
    const px = (b.x - 0.075) * W, py = (b.y - b.scat * 0.12) * horizonY, flap = Math.sin(b.ph) * (4 + near * 2);
    ctx.beginPath(); ctx.moveTo(px - 5, py + flap * 0.4); ctx.lineTo(px, py - 1); ctx.lineTo(px + 5, py + flap * 0.4); ctx.stroke();
  }
  ctx.restore();
}

// Night runway/approach lighting placed along a world-anchored strip (used by both the
// departure runway and airfield tiles). `q(along, lateral)` projects a strip-local point;
// draws white edge lights, a green threshold / red end bar, and a sequenced "rabbit" of
// approach flashers strobing toward the threshold. `phase` cycles the rabbit.
function drawRunwayLights(ctx, q, tLo, tHi, hw, now, alpha) {
  const dot = (a, s, col, r) => { const p = q(a, s); if (p.f <= 0.06) return; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.sx, p.sy, clamp(r / p.f, 0.8, 4), 0, 7); ctx.fill(); };
  ctx.save(); ctx.globalAlpha = alpha;
  for (let a = Math.ceil(tLo * 2) / 2; a <= tHi; a += 0.5) {   // edge lights every half tile
    dot(a, -hw, 'rgba(255,248,220,0.95)', 2.4); dot(a, hw, 'rgba(255,248,220,0.95)', 2.4);
  }
  dot(tLo, 0, 'rgba(90,255,120,0.98)', 3); dot(tLo, -hw, 'rgba(90,255,120,0.98)', 2.6); dot(tLo, hw, 'rgba(90,255,120,0.98)', 2.6);   // green threshold
  dot(tHi, 0, 'rgba(255,70,70,0.98)', 3); dot(tHi, -hw, 'rgba(255,70,70,0.98)', 2.6); dot(tHi, hw, 'rgba(255,70,70,0.98)', 2.6);       // red end bar
  // Approach "rabbit": a strobe running IN toward the threshold along the extended centreline.
  const step = Math.floor(now * 0.006) % 6;
  for (let k = 0; k < 6; k++) { if (k !== step) continue; dot(tLo - 0.4 - k * 0.5, 0, 'rgba(255,255,255,0.95)', 3.2); }
  ctx.restore();
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

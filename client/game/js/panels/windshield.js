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
import { aircraftFaces, wingtipStation, liveryPalette, faceBaseRgb, shadeRgb, hex2rgb, drawRotorFX, drawCockpitProp, glassSheen, drawNoseArt, deflectSurface, hingeVisorFace, visorHidden, jazzTex, jazzUV, overlayJazz, drawCanopyGlass, JAZZ_ROLE, OCCLUDE_ROLE, VIPER_SCALE } from './aircraft3d.js';
import { playThunderSample } from './engine-audio.js';
import { FLOOR_Z, BUILDING_FOOT, floorsFor } from '../../../shared/skyline-scale.js';

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
  groundDecay: 32,    // altitude e-fold (ft) for the boost → larger = the runway rush bleeds off GRADUALLY through the climb-out (a smooth takeoff→cruise transition) instead of lurching to cruise pace right at liftoff
  eh: 0.24,           // Mode-7 eye height on the GROUND — raised 0.05→0.14→0.24 to lift the camera so the near foreground drops off the bottom AND enough of the tile grid spreads into view that parked/startup ground reads as individual land tiles, not one flat sheet painted with the tile you're sitting on; a floor still keeps the runway from collapsing
  climbLift: 7.0,     // eye-height ADDED per unit altitude: EH = max(floor, eh + climbLift*height). ~2 by 500ft → clears buildings
  tile: 0.85,         // Mode-7 floor tile frequency (higher = smaller terrain tiles)
  pixel: 1,           // Mode-7 render downscale → pixel chunkiness (higher = blockier/retro). 1 is the hard floor: DS = max(1, pixel + PERF_DS), one texel per screen pixel. Dropped 4 → 1 for the crispest ground the frame will allow; `perfDS` still coarsens it under sustained load, so this is a ceiling on quality rather than a fixed cost.
  // ── Performance / adaptive-quality knobs (all live-tunable) ─────────────────────
  perfDS: 1,          // 1 = under sustained frame-load, bump the Mode-7 floor's per-pixel downscale (DS) up to +4 on top of `pixel`, quartering the ground-raster texel count. The floor is a fixed-cost software raster the canvas dynamic-res dial can't touch, so this is the one lever that sheds its load. 0 = fixed `pixel` DS always.
  wallLodPx: 20,      // building-wall LOD: a wall whose on-screen height is below this (px) skips the perspective-correct column-split textured blit (the expensive clip/transform/drawImage storm) and fills one flat shaded polygon instead — a far/small wall's window grid is an aliased blur anyway. Higher = flat-shade more walls (faster, less detail); 0 = always texture every wall.
  // Building distance LOD (see drawModelLOD). `lodNear` is where a building stops running its full
  // model arm and is drawn from its captured segments instead; at exactly that distance the two are
  // identical mass, and detail then dissolves segment-by-segment out to `lodFar`, where only the
  // largest piece remains. Set lodNear to 0 to disable LOD entirely and always run the real arms.
  // The honest cost of crossing lodNear is the arm's ADORNMENTS (neon, marquees, glow), so the
  // default sits well out in the fog — raise it if you can see the handover.
  // 1 = ground shadows are cast from the building's real captured footprint and real roof height;
  // 0 = the old single square at the storey-stack height. Kept as a switch so the whole shape system
  // has exactly two off-switches (this and lodNear) that together restore the pre-capture renderer
  // byte for byte — a claim worth being able to TEST rather than assert.
  occlude: 1,         // skip buildings entirely hidden behind a nearer one. Lossless by construction (there is no z-buffer, so a hidden building is otherwise fully built, queued, sorted and filled); the occluder/occludee boxes are biased so it can only ever be too timid. 0 = draw everything as before.
  shapeShadow: 1,
  shapeWire: 0,       // dev: stroke the captured building shapes over the render (cyan = mass, amber = entrance-face door/bay, magenta = the core segment that never fades). The one-glance check that collision/shadow/LOD geometry actually sits on the building.
  // What a distant (LOD) building is allowed to light up with. 2 = every adornment, which looks
  // right and costs nearly what the full model cost (gradients + shadowBlur, not face count, are
  // the expense). 1 = the CHEAP lights only — blinking aviation beacons, masts, dishes: no gradient,
  // no blur, so a tower is still identifiable and still warns you it's tall. 0 = nothing.
  lodAdorn: 1,
  lodNear: 20,        // tiles: full model closer than this, captured segments beyond
  lodFar: 32,         // tiles: by here a building is down to its single biggest mass
  // Distance (tiles) within which a neon sign earns a REAL glow. shadowBlur is a software blur pass
  // per draw and one of the two things that genuinely cost time in canvas2d (the other, gradient
  // construction, is now baked into sprites). An 8px halo around a blade three pixels wide is
  // invisible — so past this the sign still paints, just without the bloom. Raise it if you can see
  // the transition; 0 turns neon glow off entirely.
  glowFar: 11,
  decoFar: 16,        // distance (tiles) beyond which generic-building rooftop decorations (holo-ads, window bloom) are culled — a few px at range, not worth the fill. Higher = draw them further out.
  shadowFar: 18,      // distance (tiles) beyond which a building's ground shadow is skipped in the shadow pre-pass — distant shadows are invisible smears.
  fog: 0.2,           // N64-style distance fog: how strongly the far floor dissolves into the sky/horizon colour (0 = off/modern clear view, 1 = far ground vanishes into the fog wall). Colour tracks the sky, so it fogs pale by day and dark-blue at night. Live 'Fog (N64)' slider
  coastWarp: 0.9,     // shoreline de-blocking: domain-warps the Mode-7 terrain sample so the coast (and biome patches) meander off the square grid instead of poking out as hard 90° corners. Phased on ABSOLUTE world coords so it stays pinned to the world and never snaps on window recenter (0 = plain grid coast). Live 'Coast wobble' slider
  vlight: 1.0,        // N64 Gouraud vertex light on buildings: strength of the cyberpunk-tinted top-lit/base-shadow wall gradient (0 = flat untinted faces, 1 = full, >1 = punchier). Live 'Vertex light' slider
  // Vertex-light PALETTE (live colour pickers in ⚙). Three roles (key/sky/shadow) × day/night, lerped
  // by sky.night. Defaults = post-apocalyptic cyberpunk: sodium-amber → magenta key, sickly-green →
  // teal sky-catch, cold blue-grey → indigo-black base shadow.
  vlKeyDay: '#c69654', vlKeyNight: '#962c78',       // sun/key-lit accent (upper wall, lit side)
  vlSkyDay: '#969e96', vlSkyNight: '#1a607e',       // sky/neon catch (upper wall, shadow side)
  vlShadowDay: '#222836', vlShadowNight: '#0a0c1a', // base ambient-occlusion shadow
  bldgH: 1.40,        // building height scale (from the user's tuned screenshot)
  bldgStretch: 5.0,   // extra VERTICAL stretch on top of bldgH — makes buildings stand tall instead of pancakes; live 'Vert stretch' slider
  bldgFoot: 1.0,      // building footprint (width) scale — 1.0 fills most of the tile (a building owns its whole zone)
  texRes: 1.0,        // building texture resolution (higher = crisper, lower = chunkier)
  haze: 2.2,          // how fast the floor fades into the horizon haze (live 'Haze' slider); paired with low fog for a soft near-horizon fade instead of a hard blue fog wall
  rwl: 3.2,           // runway length (tiles)
  rwyRecede: 4.0,     // how strongly climbing pushes the runway down/under
  fov: 0.82,          // horizontal FOV / focal length (<1 pulls the scenery in toward the vanishing point = a tighter "tunnel"; 1 = the old wide spread). Pure render — collision math is world-space and unaffected.
  volClouds: 1,       // 1 = fly-THROUGH volumetric cloud deck (world-projected puff stacks that grow, part around you, and whiteout as you punch through) + camera-locked haze; 0 = the old flat dome billboards only
  cloudZ: 2.4,        // (superseded) old fixed cloud-base world-z. The fly-through deck now derives its base per-weather from a realistic altitude — see CLOUD_BASE_FT / cloudBaseZ() below.
  cloudThick: 2.4,    // vertical spread (world-z) of that deck → how tall the wall of cloud you fly through is (raised: the deck was reading too thin)
  treeDensity: 2.0,   // trees per grass tile (×) — 0 = none, live 'Trees' slider
  treeForest: 0.9,    // forest-clump threshold: patches with an area-bias above this go densely wooded; lower = more/bigger forests
  chaseBack: 1.6,     // EXTERNAL chase cam: how many tiles behind the craft the camera sits
  chaseUp: 0.22,      // EXTERNAL chase cam: world-z the camera sits above the craft (higher = looks down more; lower rides the craft higher/more centred on screen)
  chaseYaw: 12,       // EXTERNAL chase cam: resting off-astern angle (deg) so we view the craft from a slight 3/4 rear quarter, not dead-behind. Mouse orbit adds on top of this.
  chaseSink: 0.015,   // EXTERNAL view: small final trim (world-z) sinking the wheels a hair into the tarmac to hide the seam. The model is auto-anchored so its gear rests on the ground (see ownShipBaseWz) — this is just a nudge on top, no longer the whole ground offset
  chaseFrameY: 0.46,  // EXTERNAL chase cam: screen-y (fraction of canvas height) the craft's VISUAL CENTRE is pinned to — the camera pitch is solved to land it here regardless of zoom / ground vs air / orbit angle, so it never slides behind the bottom flight-stick HUD (lower = higher in frame)
  yachtMidWz: 0.11,   // HELM chase (hideOwnShip): the Echelon's visual-centre world-z, used to pin her at frameY the same zoom-stable way the own ship is pinned — so she holds her screen spot on the dolly/orbit and always frames ABOVE the helm console (raise ⇒ she sits lower in frame)
};
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rgb = (c, a) => a == null ? `rgb(${c[0]|0},${c[1]|0},${c[2]|0})` : `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const frac = (n) => { const x = Math.sin((n + 1) * 12.9898) * 43758.5453; return x - Math.floor(x); };   // deterministic 0..1 scatter
// 1-D COHERENT value noise in [0,1): hash the integer lattice with `frac`, smoothstep between the two
// neighbours. Raw frac(p*f) decorrelates EVERY sample, so scrolling p (a heading pan) reshuffles the
// whole curve — the distant ridge visibly "waved" when you yawed. vnoise TRANSLATES rigidly instead:
// scroll p and the silhouette just slides. Sample it finer than its lattice (period 1/f px) or it re-aliases.
const vnoise = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return frac(i) * (1 - u) + frac(i + 1) * u; };

// Gentle, deterministic ground elevation in WORLD tile space (flight-sim visual only) — a
// few low-frequency octaves of rolling relief. Small amplitude on purpose; used to hillshade
// the Mode-7 floor so the land reads as soft hills and coastal basins, never anything steep.
function groundElev(wx, wy) {
  return Math.sin(wx * 0.085 + 1.3) * Math.cos(wy * 0.07 - 0.7) * 0.78
       + Math.sin((wx + wy) * 0.043 + 2.1) * 0.5
       + Math.sin(wx * 0.13 - wy * 0.11 + 0.6) * 0.3     // medium rolling octave — steeper coastal hills, so the shore reads as a landmass rising, not a flat plate
       + Math.sin(wx * 0.19 - wy * 0.16) * 0.16;
}
// Extra relief ADDED only over arid land (the wildlands beyond the Curtain): sharper, carved
// badland topography on top of groundElev's gentle hills — quantized mesa terraces bounded by
// escarpment lines, plus continuous ridged rock (arroyo/canyon walls). Fed through the same
// finite-difference hillshade as groundElev, so a terrace's step edge lights up as a cliff and
// the flat tops read as plateaus. Amplitude is a few× the base hills so the plain no longer reads
// as one flat sheet. Rendering-only, like groundElev.
function wildsRelief(x, y) {
  const ridge = 1 - Math.abs(Math.sin(x * 0.16 + 0.4) * Math.cos(y * 0.14 - 0.9));           // 0..1 sharp ridge lines
  const terrace = Math.round((Math.sin(x * 0.11 - 0.6) + Math.sin(y * 0.09 + 1.7)) * 1.5) / 1.5;  // stepped mesa plateaus
  return terrace * 1.3 + ridge * ridge * 1.1;
}
// Shared relief hillshade for the Mode-7 floor: shade a tile off the elevation gradient, lit by
// the sun key. `arid` (0..1) folds in wildsRelief and widens the light/shadow range so badland
// terrain reads with more relief than the soft city hills; arid 0 reproduces the original city
// shade exactly. Called by both the built-tile LUT and the off-map wildlands fill.
function reliefShade(awx, awy, litX, litY, arid) {
  const e = (x, y) => groundElev(x, y) + (arid ? wildsRelief(x, y) * arid : 0);
  const e0 = e(awx, awy), gx = e(awx + 0.5, awy) - e0, gy = e(awx, awy + 0.5) - e0;
  return clamp(1 + (-gx * litX - gy * litY) * 3.0, 0.74 - 0.08 * arid, 1.26 + 0.08 * arid);
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

// Project a point on the celestial sphere — azimuth (° compass, but relative to the view
// heading is all that matters here) and elevation (° above the horizon) — onto the screen.
// The HORIZONTAL placement uses the SAME tan·FL mapping as the Mode-7 ground camera, so the
// sky pans in lockstep with the ground when you yaw: the sun, clouds and stars sit at real
// compass bearings and slide across (and off) the view as you turn, instead of being glued to
// the camera like a billboard. Vertical is a gentle dome above the horizon (horizonY already
// tracks pitch). `front` is false when the point is behind you — cull it.
function projSky(azDeg, elDeg, heading, W, horizonY, FL) {
  const rel = (((azDeg - heading + 540) % 360) - 180) * Math.PI / 180;   // -π..π, 0 = dead ahead
  const front = Math.abs(rel) < 1.48;                                     // ~±85°, beyond that it's behind you
  const sx = W / 2 + Math.tan(clamp(rel, -1.4, 1.4)) * FL;
  const el = clamp(elDeg, -6, 90) * Math.PI / 180;
  const sy = horizonY * (1 - Math.sin(el) * 0.86);                        // horizon at el 0 → high in the sky band at zenith
  return { sx, sy, front };
}

function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

// The height (in world grid units) the cloud deck sits above the aircraft — sets how fast a
// front rises from the horizon toward overhead as you close on it. A cell this far away sits at
// 45° elevation; nearer cells climb toward the zenith, distant ones hug the horizon.
const CLOUD_SKY_H = 5;

// Advance the client's local copy of the weather cells one frame. The field is deterministic and
// each cell carries its own velocity (grid units per `tick` seconds), so the client extrapolates
// the moving fronts forward at 60fps on its own — it needn't be re-sent every frame; the next
// server snapshot just re-seats any accumulated drift. Torus-wrap mirrors the server's advectField.
function stepWeatherCells(st, field, dt) {
  if (!field || !field.cells || !field.cells.length) { st.cells = null; st.wxRef = field; return; }
  if (st.wxRef !== field) {   // new server snapshot → re-seat positions (keep drifting from here)
    st.wxRef = field;
    st.cells = field.cells.map((c, i) => ({ ...c, seed: i * 7.13 + 1.7 }));
    st.wxBounds = field.bounds; st.wxTick = field.tick || 30;
  }
  const b = st.wxBounds, pad = 2, per = dt / (st.wxTick || 30);
  for (const c of st.cells) {
    c.x += c.vx * per; c.y += c.vy * per;
    if (!b) continue;
    const lo = b.minX - c.r - pad, spanX = (b.maxX - b.minX) + c.r * 2 + pad * 2;
    const loY = b.minY - c.r - pad, spanY = (b.maxY - b.minY) + c.r * 2 + pad * 2;
    if (c.x < lo) c.x += spanX; else if (c.x > lo + spanX) c.x -= spanX;
    if (c.y < loY) c.y += spanY; else if (c.y > loY + spanY) c.y -= spanY;
  }
}

// Sample cloud cover + precipitation at the aircraft — the same overlap math the server field
// uses (sampleWeatherAt), so the rain out the canopy matches the weather you're actually flying
// through: fly into a rain cell and it starts, fly out and it stops.
function sampleWeatherCells(cells, ax, ay) {
  let cloud = 0, precip = 0, storm = 0, ptype = 'none';
  for (const c of cells) {
    const d = Math.hypot(ax - c.x, ay - c.y);
    if (d >= c.r) continue;
    const f = c.intensity * smoothstep(1 - d / c.r);
    if (f <= 0) continue;
    cloud = Math.max(cloud, f);
    if (c.type === 'precip' || c.type === 'storm') { if (f > precip) { precip = f; ptype = c.precip; } if (c.type === 'storm') storm = Math.max(storm, f); }
  }
  return { cloud, precip, storm, ptype };
}

// ── Lightning ─────────────────────────────────────────────────────────────────
// Strikes rain down INSIDE the storm cells of the weather field — the same system that drives the
// clouds and rain — at a real world tile-offset from the aircraft. Each bolt is a jagged vertical
// channel (+forks) stored in world space (tile dx/dy + a 0..1 height fraction), projected through
// the world camera (cam.proj) so it's a true 3-D bolt: it pans/banks with the world, foreshortens
// with distance, and recedes toward the horizon like everything else out there.
const BOLT_MAX_DIST = 65;   // tiles: strikes farther than this are too distant to render as a bolt

// Server-pushed strikes waiting to become bolts. The engine's stormTick is the sole
// strike authority (so the sim matches the ground weather); the flight message relays
// each located strike here and the next forward-view paint turns it into a 3-D bolt.
const _pendingStrikes = [];
export function pushLightningStrike(gx, gy, intensity) {
  if (!Number.isFinite(gx) || !Number.isFinite(gy)) return;
  _pendingStrikes.push({ gx, gy, intensity: intensity ?? 0.6 });
  if (_pendingStrikes.length > 24) _pendingStrikes.shift();   // bound if no sim is draining
}

// Nodes are stored as lateral offsets (ox,oy tiles) from the WORLD strike point (bx,by) plus a
// 0..1 height fraction, so the bolt stays anchored in the world for its whole (brief) life — the
// aircraft-relative offset is recomputed each frame rather than frozen at spawn.
function makeBolt(bx, by, t0, intensity) {
  const segs = 9, jit = () => (Math.random() - 0.5);
  const pts = []; let ox = 0, oy = 0;
  for (let i = 0; i <= segs; i++) {
    pts.push({ ox, oy, f: 1 - i / segs });   // f: 1 = cloud base … 0 = ground
    ox += jit() * 0.55; oy += jit() * 0.55;
  }
  const forks = [];
  for (let k = 0, nf = 1 + (Math.random() < 0.5 ? 1 : 0); k < nf; k++) {
    const i0 = 3 + (Math.random() * (segs - 4) | 0), base = pts[i0];
    let fx = base.ox, fy = base.oy, ff = base.f;
    const fp = [{ ox: fx, oy: fy, f: ff }];
    for (let j = 0, fl = 2 + (Math.random() * 3 | 0); j < fl; j++) {
      fx += jit() * 0.8; fy += jit() * 0.8; ff = Math.max(0, ff - (0.09 + Math.random() * 0.07));
      fp.push({ ox: fx, oy: fy, f: ff });
    }
    forks.push(fp);
  }
  return { bx, by, pts, forks, t0, dur: 220 + Math.random() * 180, intensity };
}

function drawBoltPath(ctx, cam, pts, dx, dy, topZ, bright) {
  const sp = pts.map(p => cam.proj(dx + p.ox, dy + p.oy, p.f * topZ));
  ctx.strokeStyle = `rgba(150,190,255,${0.32 * bright})`; ctx.lineWidth = 6;   // glow
  ctx.beginPath(); ctx.moveTo(sp[0].sx, sp[0].sy); for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i].sx, sp[i].sy); ctx.stroke();
  ctx.strokeStyle = `rgba(242,248,255,${0.95 * bright})`; ctx.lineWidth = 1.8;   // core
  ctx.beginPath(); ctx.moveTo(sp[0].sx, sp[0].sy); for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i].sx, sp[i].sy); ctx.stroke();
}

function drawLightning(ctx, cam, st, now, acX, acY) {
  if (!st.bolts || !st.bolts.length) return;
  const topZ = Math.max(3.5, cam.EH + 1.5);   // cloud-base world-z above the eye → bolt spans down to ground at any altitude
  ctx.save();
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const b of st.bolts) {
    const age = now - b.t0; if (age >= b.dur) continue;
    const dx = b.bx - acX, dy = b.by - acY;
    const fwd = dx * cam.sinh - dy * cam.cosh;   // forward distance — cull strikes behind the camera
    if (fwd < 0.15) continue;
    // Flicker: a couple of sharp restrikes that decay over the life.
    const bright = clamp(Math.max(0, 1 - age / b.dur) * (0.55 + 0.45 * Math.sin(age * 0.085)) * (Math.random() < 0.85 ? 1 : 0.35), 0, 1);
    if (bright <= 0.03) continue;
    drawBoltPath(ctx, cam, b.pts, dx, dy, topZ, bright);
    for (const f of b.forks) drawBoltPath(ctx, cam, f, dx, dy, topZ, bright * 0.7);
  }
  ctx.restore();
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

// ── Weather → ground-haze ceiling ─────────────────────────────────────────────
// How far the Mode-7 floor is allowed to wash toward the horizon colour with distance.
// Clear skies keep the terrain crisp all the way out (a whisper only at the true horizon
// line); fog/ash/storm thicken the air so distant ground genuinely dissolves. This is the
// CEILING on the per-pixel haze weight in drawMode7Floor — hz (the live slider) still sets
// how fast it climbs toward this cap.
// The two hero events ride this table as pseudo weather types: acid sits between
// storm and ash (a thick chemical murk you can still just about see through), an
// ion storm dirties the air with charged dust. Everything downstream that keys
// off `wx` — haze, glare, aurora — then treats them as first-class weather with
// no extra plumbing.
const WX_HAZE = {
  clear: 0.12, cloudy: 0.22, rain: 0.3, snow: 0.34, storm: 0.42, ash: 0.55, fog: 0.75,
  acid_rain: 0.5, ion_storm: 0.38,
};
const hazeCeil = (wx) => WX_HAZE[wx] ?? 0.15;

// Full-canopy colour cast for a hero event. Alpha scales with phase, so the
// approach is a tint and the peak is a wall.
const WX_EVENT_CAST = {
  acid_rain: [150, 200, 40],
  ion_storm: [90, 255, 150],
};
// What each hero event physically does to the canopy — reuses the existing rain
// and storm on-glass behaviour rather than authoring new drop art.
const WX_EVENT_AS = { acid_rain: 'rain', ion_storm: 'storm' };

// ── Biome ground tint (the near/mid ground colour when flying over a district) ──
// Not the flat map colours — the material the ground reads as from the air: arid
// desert over the badlands, dark water over the bay, ashen concrete over industry.
// The old grey urban/industrial districts now read as GRASS (green) — bare terrain between
// buildings is turf, not concrete. Roads (asphalt) and the airport are painted opaquely on
// top of this, so they're unaffected; only the base ground turns green. Kept as-is: water
// (blue), badlands (desert tan), parkland (already green), airport (grey ramp). Slight
// per-district variation so a whole city isn't one flat green.
const BIOME_GROUND = {
  badlands: [150, 112, 72], water: [34, 62, 88], docks: [54, 90, 54],
  ruins: [78, 98, 56], oldcoldwater: [56, 94, 52], industrial: [52, 86, 48],
  infra: [54, 92, 50], freight: [54, 90, 50], marquee: [58, 96, 54],
  citycore: [56, 96, 52], parkland: [58, 92, 54], park: [52, 112, 50], uptown: [60, 104, 56], civic: [58, 98, 54],
  airport: [60, 64, 60],
  // Arid wildlands beyond the Curtain: dry olive scrub, rust-red mesa, burnt ash flats.
  scrub: [126, 120, 78], redrock: [150, 82, 54], ash: [84, 80, 74],
  // Painted paved surfaces (flags.terrain): dark tarmac, pale concrete slab, weathered
  // dock planking. Deliberately NOT in GRASS_BIOMES, so they take the concrete-checker
  // material and read as pavement instead of turf.
  asphalt: [58, 60, 66], concrete: [108, 112, 116], pier: [96, 78, 54],
};
// Biomes whose bare ground reads as GRASS — the fine vegetation mottle instead of the
// concrete checker, so the green above lands as turf. Kept OFF: water, desert badlands, and
// the airport ramp (stays concrete grey).
const GRASS_BIOMES = new Set(['parkland', 'park', 'citycore', 'uptown', 'civic', 'infra', 'freight',
  'marquee', 'oldcoldwater', 'industrial', 'ruins', 'docks']);
// Bare dry-land biomes — get the carved badland relief (wildsRelief), a per-tile arid tint
// jitter, and the sand-ripple/cracked-clay ground material instead of flat fill. The off-map
// wildlands fill is arid by construction, so it isn't listed here (it passes arid=1 directly).
const ARID_BIOMES = new Set(['scrub', 'redrock', 'ash', 'badlands']);
// Man-made / paved surfaces — the coast-wobble domain warp skips these so a concrete slab, tarmac,
// pier or airport ramp keeps its straight built edges instead of going wavy (apron tiles are added
// dynamically in the LUT via the nearField test).
const PAVED_BIOMES = new Set(['asphalt', 'concrete', 'pier', 'airport']);
// Grey asphalt apron colour + a test for "next to a runway": a grassed district tile that
// touches an airfield/field surface stays concrete-grey (and grows no trees), so the paved
// area around a strip reads as tarmac, not turf, even though the wider district is green.
const APRON_GREY = [60, 64, 60];
function nearField(map, rx, ry) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const row = map[ry + dy], c = row && row[rx + dx];
    if (c && ((c.kind === 'field' && !c.bt) || c.biome === 'airport')) return true;   // a rooftop pad's block keeps its own ground — no apron greying around a tower
  }
  return false;
}

function sceneFor(id, W, H) {
  let st = _scenes.get(id);
  if (!st) {
    // Deterministic-ish scatter without Math.random dependence on first frame.
    const rnd = (n) => { let x = Math.sin((n + 1) * 12.9898) * 43758.5453; return x - Math.floor(x); };
    st = { scroll: 0, sideScroll: 0, last: 0, w: 0, h: 0, flash: 0, bolt: null, boltT: 0,
      // World-anchored sky bodies: fixed compass bearing (az 0..360) + elevation (° above the
      // horizon), projected fresh each frame so they hold their place in the sky as you yaw.
      stars: Array.from({ length: 70 }, (_, i) => ({ az: rnd(i) * 360, el: 4 + rnd(i + 91) * 70, m: 0.4 + rnd(i + 7) * 0.6 })),
      // Two layered cumulus bands: a low, fat foreground band and a higher, smaller/faster one.
      // `drift` slowly advects the bearing (real cloud movement) on top of the yaw-driven pan.
      clouds: Array.from({ length: 12 }, (_, i) => { const hi = i % 3 === 0; return {
        az: rnd(i * 3) * 360, el: hi ? 20 + rnd(i * 5) * 16 : 5 + rnd(i * 5) * 12,
        s: (hi ? 0.5 : 0.9) + rnd(i * 2) * 0.8, drift: (0.4 + rnd(i) * 0.9) * (hi ? 1.5 : 1) }; }),
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
  const ctx = cv.getContext('2d');
  const st = sceneFor(id, cw, ch);
  const baseDpr = Math.min(2, window.devicePixelRatio || 1);
  // Dynamic resolution scaling: under sustained frame-time load, shrink the backing store below
  // native and let CSS upscale it — the broadest fps lever, since it scales EVERY pass at once
  // (clouds, buildings, ground), not just the volumetric deck. Driven off last frame's smoothed
  // frameMs (persisted on st); eased for a smooth ramp, then QUANTISED to 0.1 steps so the canvas
  // backing store only re-allocates when it crosses a step — a per-frame ±1px resize would thrash
  // the allocator and flicker. Floor 0.6 keeps the view legible under the worst weather load.
  const resTarget = clamp(1 - ((st.frameMs || 16) - 20) / 44, 0.6, 1);   // full res ≤20ms (50fps); ramps to the 0.6 floor by ~46ms — engages EARLIER so it defends a 60fps target before the frame time has already collapsed
  st.resScale = st.resScale ? st.resScale + (resTarget - st.resScale) * 0.08 : resTarget;
  const dpr = baseDpr * (Math.round(st.resScale * 10) / 10);
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
  const now = performance.now();
  const raw = st.last ? (now - st.last) : 16;
  const dt = Math.min(0.05, st.last ? raw / 1000 : 0.016); st.last = now;
  // Smoothed frame time → a cloud-quality dial. When frames run long (heavy cloud decks are the
  // usual culprit), shrink the volumetric puff budget so the fly-through layer sheds load and fps
  // recovers; the EMA damps it into a stable equilibrium instead of oscillating. 1 = full quality
  // (≤~22ms/45fps), down to 0.3 under sustained load. Read by drawVolumetricClouds below.
  st.frameMs = st.frameMs ? st.frameMs + (raw - st.frameMs) * 0.1 : raw;
  // Adaptive Mode-7 downscale: the ground raster is a fixed-cost per-pixel software loop the canvas
  // dynamic-res dial above can't reach (its buffer is sized in CSS-px/DS space, not backing pixels), so
  // under sustained load bump DS up to +4 on top of RENDER_TUNE.pixel — quartering the texel count at
  // the cost of a slightly chunkier (on-brand) floor. Read by drawMode7Floor this same frame.
  PERF_DS = RENDER_TUNE.perfDS !== 0 ? clamp(Math.round((st.frameMs - 24) / 8), 0, 4) : 0;   // 24ms→0, 32→+1, 40→+2 … cap +4
  // Floor raised 0.3→0.5: under a heavy deck the puff budget shed as much as 70% of its puffs,
  // and since heavy clouds ARE the load the dial oscillated the deck — on-screen puffs blinked out
  // and back as frames breathed. A 0.5 floor halves that swing (min budget 170, not 102) so the
  // visible deck stays put; the soft budget edge below fades the far tail we still can't afford.
  st.cloudQ = clamp(1 - (st.frameMs - 22) / 26, 0.5, 1);

  const v = view || {};
  // Look direction: Q/E/S swivel the camera off the nose (viewYaw ≠ 0) while the aircraft
  // keeps flying straight ahead — the WORLD renders in the look direction, but the HUD
  // (heading tape, airport tags) always reads true heading. The passenger cabin (side)
  // is a fixed 90° off the nose — always perpendicular to the direction of travel, even
  // down the runway on takeoff. Everything else is shared.
  const side = !!v.side;                                    // passenger side window (looks 90° off the nose)
  // "Framed" = the view is seen THROUGH a window punched in the hull (passenger cabin
  // or the pilot's Q/E/S side-look), not the forward windscreen. Forward-only canopy
  // flourishes (skyline glow, speed streaks, hero clouds, the canopy bow) are all
  // suppressed so the scene reads as a porthole, and drawWindowFrame masks the hull skin.
  const framed = side || !!v.windowClass;
  const ext = !!v.external && !framed;   // external chase view: a real camera behind + above the craft
  // External orbit: hold the middle mouse to spin the chase camera around the craft. Adding it to
  // the VIEW heading rotates the world + camera around the aircraft, while the model keeps its own
  // real heading (drawn below), so we see the plane from the orbit angle. The camera LOCKS wherever
  // you leave it (no spring-back); the ⟲ reset button zeroes it.
  // FIRING (v.firing) overrides the locked orbit: while the trigger is HELD it snaps the chase camera
  // dead-astern (no yaw, no elevation) so the boresight runs up the screen centre for the gun run.
  // Just being armed no longer locks the camera — you can orbit freely and aim from any angle (the
  // reticle projects through the live camera), and it snaps home only while you're actually shooting.
  const extOrbit = ext ? (v.firing ? 0 : (v.extYaw || 0) + RENDER_TUNE.chaseYaw) : 0;
  const yawOff = (v.viewYaw || (v.side ? 90 : 0)) + extOrbit;
  const vw = yawOff ? { ...v, heading: (v.heading || 0) + yawOff } : v;
  const W = cw, H = ch, speed = clamp(v.speed || 0, 0, 1), height = clamp(v.height || 0, 0, 1);
  const phase = v.phase || 'cruise';
  // A hero event OUTRANKS the ordinary weather type for everything visual: when
  // the sky is doing something with a name, that's what you're flying through.
  const wxEvent = v.event?.type && WX_EVENT_CAST[v.event.type] ? v.event : null;
  const wx = wxEvent ? wxEvent.type : (v.weather || 'clear').toLowerCase();
  const sky = skyAt(v.hour == null ? 12 : v.hour);
  // Chase distance is size-relative: the camera sits `chaseBack` tiles behind a reference
  // (prop-class) craft, but pulls IN for physically smaller airframes (the Mayfly ultralight
  // is ~half the size, so a fixed distance left it a dot) — normalised against CONTACT_SIZE so
  // every class fills a comparable slice of the frame. `extZoom` (mouse wheel) scales on top.
  const szRef = CONTACT_SIZE.prop || 0.11;
  // Floor raised 0.28 → 0.46: the smallest airframes (the Mini 500 heli, ratio ~0.29) were pulling the
  // camera in so tight the resting chase read as an uncomfortably close, squashed crop. The floor still
  // lets a tiny craft sit CLOSER than a prop (so it isn't a distant speck) but keeps a comfortable
  // standoff — the wheel can always dolly further in from here.
  // The armed heli (Viper) is a physically much bigger airframe than the Dragonfly it shares
  // a class — and therefore a CONTACT_SIZE — with, so it counts as VIPER_SCALE× here or the
  // camera would sit at Mini-500 standoff against a gunship and crop it tight.
  const szOwn = (CONTACT_SIZE[v.cls] || szRef) * (v.cls === 'heli' && v.armed ? VIPER_SCALE : 1);
  const szFac = clamp(szOwn / szRef, 0.46, 1.15);
  const extZoom = clamp(v.extZoom || 1, 0.15, 2.4);   // floor lowered 0.30→0.15 so the camera can dolly in for a genuinely TIGHT crop (the Echelon deck-cam's final on-pad hold pushes down here) — only extends how far the wheel can zoom IN, resting default (1) unchanged
  // Vertical orbit (middle-drag up/down): the chase camera rides a fixed-radius ARC around the
  // craft — a turntable, like the hangar walkaround — instead of sliding straight up. `extPitch` is
  // the ELEVATION ANGLE (rad): + lifts the camera up-and-over to look DOWN on the craft, − drops it
  // down-and-under to look UP at the belly. The radius is the same chaseBack the zoom scales, so the
  // azimuth orbit + zoom are untouched and the resting pose still matches the old behind-and-above cam.
  const orbR = RENDER_TUNE.chaseBack * szFac * extZoom;
  const restPitch = Math.asin(clamp(RENDER_TUNE.chaseUp / RENDER_TUNE.chaseBack, -1, 1));   // the old slight-above resting angle
  // Ground clamp: the eye can never sink below the terrain. EH = EHbase + up is floored at 0.05
  // downstream; here we solve the lowest arc angle that keeps the camera a hair above that floor.
  // EHbase grows with altitude, so you can swing FULLY under the craft up high, but near the deck the
  // ground blocks the under-view — exactly "rotate under unless it runs the camera into the ground".
  const EHbaseC = Math.max(0.05, RENDER_TUNE.eh + height * RENDER_TUNE.climbLift);
  const groundPitch = Math.asin(clamp((0.06 - EHbaseC) / Math.max(1e-3, orbR), -1, 1));
  const extPitch = ext && !v.firing ? clamp(v.extPitch != null ? v.extPitch : restPitch, groundPitch, 1.15) : restPitch;
  // Over-the-top distortion fix: a close chase cam looking straight down sits almost on top of the
  // craft, so buildings directly below streak and fan out and the view reads as uselessly zoomed-in.
  // As the orbit pitches UP past the resting angle toward top-down, pull the camera proportionally
  // farther out (up to ~2.4×) — that widens the framing and flattens the perspective. The resting
  // behind-and-above pose (topFrac 0) and the whole under-belly swing are untouched.
  const topFrac = clamp((extPitch - restPitch) / (1.15 - restPitch), 0, 1);
  const orbRcam = orbR * (1 + topFrac * 1.4);
  const chase = ext ? { back: orbRcam * Math.cos(extPitch), up: orbRcam * Math.sin(extPitch) } : null;   // camera on the arc: tiles behind / world-z above the craft
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
  // The moon rides the opposite arc (up ~18:30→05:30), giving the night sea a light to glitter
  // off — otherwise open water goes pure black once the city glow is gone. Same world-direction
  // form as the sun so drawMode7Floor can lay a specular path toward it.
  const moonT = hour >= 18.5 ? (hour - 18.5) / 11 : (hour < 5.5 ? (hour + 5.5) / 11 : -1);
  const moonUp = moonT >= 0 && moonT <= 1, moonAng = moonUp ? moonT * Math.PI : 0;
  const sunFx = {
    elev: sunElev, night: sky.night,
    dir: [Math.cos(sunAng), Math.sin(sunAng)],               // toward the sun (world dx,dy)
    shadowDir: [-Math.cos(sunAng), -Math.sin(sunAng)],       // shadows fall away from it
    len: sunUp ? clamp(0.6 + (1 - sunElev) * 2.4, 0.5, 3.4) : 0,   // long shadows at low sun
    alpha: sunUp ? clamp(0.30 * (0.35 + sunElev), 0.08, 0.34) : 0,
    moonElev: moonUp ? Math.sin(moonAng) : 0,                 // 0 at moonrise/set, 1 overhead
    moonDir: [Math.cos(moonAng), Math.sin(moonAng)],          // toward the moon (world dx,dy)
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
  // Unified Mode-7 path (worldBlend 1): ONE continuous pitch+altitude horizon on the deck and aloft
  // alike, so parked → roll → rotate → climb is a single believable move down the real runway. The
  // legacy modal decks (worldBlend < 1, paired with the hand-drawn airport strip) keep the old
  // reveal-driven ground horizon that sinks the apron off the bottom as you rotate.
  // Cargo-visor tilt: while the Leviathan's nose (and the flight deck with it) is hinged up, the
  // first-person camera pitches up to match — the horizon drops toward the bottom and the view
  // fills with sky, sweeping back to level over the ~5s the nose takes to seat. Cockpit view only
  // (the external chase keeps its own arc-solved horizon), so the drawn model attitude is untouched.
  const visorTilt = ext ? 0 : (v.cockpitTilt || 0) * H * 0.52;
  const rawHorizon = (onDeck && worldBlend < 0.999)
    ? lerp(H * 1.08, H * 0.42, reveal)
    // Cockpit horizon: normal pitch/altitude term, plus the visor tilt — but HARD-CAPPED at 0.88H so
    // even with the nose fully raised the horizon (and a sliver of apron beneath it) stays on-screen
    // instead of sliding off the bottom into the Mode-7 floor's empty range.
    : Math.min(H * 0.88, clamp(H * 0.46 + (v.pitch || 0) * H * 0.016 + (height - 0.2) * H * 0.09, H * 0.14, H * 0.84) + visorTilt);
  // Ease the horizon across frames so the runway→sky handoff (ground phase → cruise,
  // which swaps the formula) glides instead of snapping.
  if (st.horizon == null) st.horizon = rawHorizon;
  else st.horizon += (rawHorizon - st.horizon) * Math.min(1, dt * 5);
  // In the EXTERNAL chase the vertical orbit must sweep a SPHERE around the craft: the camera arcs
  // over/under while the aircraft stays pinned in-frame and the sky+ground pitch around it. The camera
  // POSITION already rides the arc (chase.back/up), but the VIEW must also PITCH to keep looking at the
  // craft — otherwise it just dollies up and the plane slides down the frame. We solve the horizon that
  // lands the own ship at a FIXED screen position for the current arc angle.
  let horizonY = st.horizon;
  if (ext && !v.firing && chase) {
    const D = H * 0.55;                                        // = focal, makeCam's vertical projection scale
    const baseWz = ownShipBaseWz({ EHbase: EHbaseC, R: v.map ? (v.map.length - 1) / 2 : 0 }, v);
    if (v.hideOwnShip) {
      // Helm chase (no own aircraft — the Echelon's yacht cell is the framed subject, drawn at the
      // centre tile dx,dy=0 exactly where the own ship would be). Pin her VISUAL CENTRE to a fixed
      // screen fraction (frameY) the SAME zoom- and orbit-stable way the own ship is pinned below, so
      // she holds that screen spot no matter the dolly/orbit and — crucially — always frames ABOVE the
      // helm console. (The old resting-pin let her float low, so she read as blocked behind the dash.)
      // frameY defaults to chaseFrameY; the helm console lowers it to seat her in the clear water band.
      const EH = Math.max(0.05, EHbaseC + chase.up);
      const midWz = RENDER_TUNE.yachtMidWz;
      const fy = v.frameY != null ? v.frameY : RENDER_TUNE.chaseFrameY;
      horizonY = H * fy - D * (EH - midWz) / Math.max(1e-3, chase.back);
    } else {
      // Own-ship external: pin the model's VISUAL CENTRE to a fixed screen fraction. The own ship draws at
      // dx,dy=0, so its centre (world-z = baseWz + modelMidH) projects to `horizonY + D*(EH - midWz)/back`;
      // invert that for the horizon that lands it on chaseFrameY. This is zoom- AND altitude-stable (the
      // altitude term cancels: baseWz climbs with EHbaseC), so the craft never slides behind the stick HUD
      // as you zoom in on the ground — the failure mode the old resting-pin had (its back scaled with zoom).
      const EH = Math.max(0.05, EHbaseC + chase.up);            // matches makeCam's summed, floored eye-height
      const midWz = baseWz + modelMidH(v.cls, !!v.armed);
      horizonY = H * RENDER_TUNE.chaseFrameY - D * (EH - midWz) / Math.max(1e-3, chase.back);
    }
  }
  // In the EXTERNAL chase view the camera holds a LEVEL horizon and you watch the plane roll
  // against a static sky (a proper chase cam) — so the world (sky/clouds/sun/ground) doesn't spin
  // with your bank. The cockpit view still banks the world fully for immersion.
  const bankRad = ext ? 0 : (v.bank || 0) * Math.PI / 180;

  // ── Cinematic-flourish placement + strength scalars ───────────────────────────
  // The sun's on-screen position (same placement the sky disc uses), hoisted so the
  // god-rays, glare, and lens flare all read from one source. sunSky* is the pre-bank
  // world frame (used inside the banked block); sunFlare* is that point re-projected
  // through the bank + turbulence shake into screen space (used after the world restore).
  // The sky camera's focal length — identical to the Mode-7 ground camera (makeCam) so the
  // sun/clouds/stars pan at exactly the ground's rate when you yaw. The sun rides a real
  // E→S→W arc (az 90→270) at an elevation that peaks at noon, projected through projSky.
  const skyFL = (W / 2) / 1.15 * (RENDER_TUNE.fov || 1);
  const _sunT = clamp((hour - 6) / 12, 0, 1);
  const _sunPos = projSky(90 + _sunT * 180, sunElev * 62, vw.heading, W, horizonY, skyFL);
  const sunSkyX = _sunPos.sx, sunSkyY = _sunPos.sy, sunFront = _sunPos.front;
  const _cosB = Math.cos(bankRad), _sinB = Math.sin(bankRad), _sdx = sunSkyX - W / 2, _sdy = sunSkyY - H / 2;
  const sunFlareX = W / 2 + (_sdx * _cosB + _sdy * _sinB) + shX;
  const sunFlareY = H / 2 + (-_sdx * _sinB + _sdy * _cosB) + shY;
  // A single "key light" screen point for cloud silver-lining: the sun by day, the moon by night
  // (the moon rides the opposite arc — mirrors the sun/moon disc placement below). Clouds draw a
  // bright feathered edge on the lobe facing this point, so a front reads as backlit, not flat grey.
  const _moonT = hour >= 18.5 ? (hour - 18.5) / 11 : (hour + 5.5) / 11;
  const _moonPos = projSky(90 + _moonT * 180, Math.sin(_moonT * Math.PI) * 55, vw.heading, W, horizonY, skyFL);
  const _dayKey = sunUp && sunFront;
  const lightX = _dayKey ? sunSkyX : _moonPos.sx, lightY = _dayKey ? sunSkyY : _moonPos.sy;
  const lightStr = _dayKey ? clamp(0.4 + sunElev * 0.6, 0, 1) : (sky.night > 0.4 && _moonPos.front ? 0.7 : 0);
  const _clearish = wx === 'clear' || wx === 'cloudy';
  const glareStr = (sunUp && sunFront && !framed && _clearish) ? clamp(0.32 + (1 - sunElev) * 0.7, 0, 1) * (wx === 'cloudy' ? 0.45 : 1) : 0;
  const rayStr   = (sunUp && sunFront && !framed && _clearish && worldBlend > 0.02) ? clamp((0.55 - sunElev) / 0.55, 0, 1) * (wx === 'cloudy' ? 0.5 : 1) : 0;
  const auroraOn = sky.night > 0.4 && (wx === 'clear' || wx === 'ash') && !framed;
  const cockpitGlow = clamp(sky.night * 0.85 + (sunUp && sunElev < 0.28 ? 0.22 : 0), 0, 1);
  // Instrument-panel lights (the PANEL switch): flipping them on gives a guaranteed, richer warm
  // glow pooled up onto the lower canopy — the "instruments lit" ambience — even at dusk when the
  // ambient time-of-day reflection alone would be faint.
  const panelLit = !!v.panelLight;
  const instrGlow = panelLit ? Math.max(cockpitGlow, 0.4) : cockpitGlow;
  const _hotTheme = !!airport && (v.airport === 'city' || v.airport === 'slag' || v.airport === 'wastes');
  const shimmerStr = (onDeck && _hotTheme && sunElev > 0.35 && !framed) ? clamp((sunElev - 0.35) / 0.5, 0, 1) : 0;
  const _gTurn = clamp((Math.abs(v.bank || 0) - 35) / 45, 0, 1);
  const vaporStr = (!framed && !ext && worldBlend > 0.5) ? clamp(Math.max(speed * 0.55 - 0.22, _gTurn), 0, 1) : 0;
  // Ground palette: airport terrain colours on the deck; airborne, tint the sky's
  // ground band toward the biome you're flying over (desert tan, bay blue, urban grey).
  let gTop = airport ? mix(airport.g1, [0, 0, 0], sky.night * 0.45) : sky.g1;
  let gBot = airport ? mix(airport.g2, [0, 0, 0], sky.night * 0.5) : sky.g2;
  // On the deck at a field the craft sits on a PAVED taxiway/apron, not grass: blend the
  // ground toward tarmac grey by `reveal` (1 = parked/on the deck). The near foreground
  // (gBot) paves fully; the distance (gTop) keeps more turf, so it reads as apron in front
  // fading to field grass toward the horizon, and crossfades back as you rotate + climb away.
  if (airport) {
    const tar = mix(APRON_GREY, [0, 0, 0], sky.night * 0.5);
    gBot = mix(gBot, tar, reveal * 0.9);
    gTop = mix(gTop, tar, reveal * 0.35);
  }
  if (!airport && v.biomeBelow && BIOME_GROUND[v.biomeBelow]) {
    const t = mix(BIOME_GROUND[v.biomeBelow], [0, 0, 0], sky.night * 0.5);
    gTop = mix(gTop, t, 0.6); gBot = mix(gBot, mix(t, [0, 0, 0], 0.35), 0.6);
  }

  // Backstop: a plain sky→ground wash under the whole canvas, so a steep bank (external chase
  // view especially) never exposes the near-black canvas backing in a corner the rotated,
  // oversized sky/ground rects don't quite reach. Normally fully painted over — only the last
  // corner sliver ever shows it, and a rough sky/ground colour there beats a black wedge.
  { const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, rgb(sky.top)); bg.addColorStop(clamp(horizonY / H, 0.05, 0.95), rgb(sky.hor)); bg.addColorStop(1, rgb(gBot));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }

  // World (banks with the aircraft) — draw oversized so rotation never reveals edges.
  // A turbulence shudder (shX/shY) rides on the translate so the whole scene trembles in wind.
  ctx.save();
  ctx.translate(W / 2 + shX, H / 2 + shY); ctx.rotate(-bankRad); ctx.translate(-W / 2, -H / 2);
  const OX = W, ex = W * 3;   // over-extents

  // Sky.
  let g = ctx.createLinearGradient(0, -H, 0, horizonY);
  g.addColorStop(0, rgb(sky.top)); g.addColorStop(1, rgb(sky.hor));
  ctx.fillStyle = g; ctx.fillRect(-OX, -H, ex, horizonY + H);

  // Stars (night) — anchored to real sky positions, so the field wheels overhead as you turn.
  if (sky.night > 0.15) {
    ctx.fillStyle = rgb([230, 236, 255], sky.night);
    for (const s2 of st.stars) { const p = projSky(s2.az, s2.el, vw.heading, W, horizonY, skyFL); if (!p.front || p.sy > horizonY) continue; const tw = 0.5 + 0.5 * Math.sin(now * 0.002 * s2.m + s2.az); ctx.globalAlpha = sky.night * s2.m * tw; ctx.fillRect(p.sx, p.sy, 1.4, 1.4); }
    ctx.globalAlpha = 1;
  }
  // Aurora / ash-glow curtains high in the night sky.
  if (auroraOn) drawAurora(ctx, W, horizonY, now, sky, wx);
  // Sun / moon — placed at a REAL sky position (compass bearing + elevation) via projSky, so it
  // holds its spot in the sky and slides off / behind you as you turn, instead of hanging in the
  // same screen corner. The sun reuses the pre-computed sunSky point; the moon rides the opposite
  // (night) arc. Culled when it's behind the camera.
  if (sky.sun || sky.night > 0.4) {
    const isMoon = !sky.sun && sky.night > 0.4;
    let bodyX = sunSkyX, bodyY = sunSkyY, bodyFront = sunFront;
    if (isMoon) {
      // Night arc: rises as the sun sets (18.5h) and sets at dawn (5.5h) — 11 night hours.
      const nT = hour >= 18.5 ? (hour - 18.5) / 11 : (hour + 5.5) / 11;
      const mp = projSky(90 + nT * 180, Math.sin(nT * Math.PI) * 55, vw.heading, W, horizonY, skyFL);
      bodyX = mp.sx; bodyY = mp.sy; bodyFront = mp.front;
    }
    if (bodyFront) {
      const disc = sky.sun || [220, 226, 236];
      const rg = ctx.createRadialGradient(bodyX, bodyY, 2, bodyX, bodyY, 46);
      rg.addColorStop(0, rgb(disc, 0.95)); rg.addColorStop(0.4, rgb(disc, 0.5)); rg.addColorStop(1, rgb(disc, 0));
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(bodyX, bodyY, 46, 0, 7); ctx.fill();
      ctx.fillStyle = rgb(disc, 0.95); ctx.beginPath(); ctx.arc(bodyX, bodyY, isMoon ? 12 : 15, 0, 7); ctx.fill();
    }
  }
  // Spatial weather: advect the field's cloud/precip/storm cells locally (60fps between packets),
  // then sample what the aircraft is flying through so both the clouds and the rain are the REAL
  // weather at our position. Falls back to the procedural deck when no field data is plumbed.
  stepWeatherCells(st, v.wxField, dt);
  const wxSample = (st.cells && v.acX != null) ? sampleWeatherCells(st.cells, v.acX, v.acY) : null;
  const localStorm = wxSample ? Math.max(wxSample.storm, wxSample.precip * 0.7) : 0;

  // Lightning is server-authoritative: the engine (stormTick) is the SINGLE strike
  // source and pushes each located strike here via pushLightningStrike, so the sim
  // shows exactly the strikes the ground weather produces — no client-side cadence.
  // We drain the queue on the forward view, which has our live world position for
  // the distance cull + the near-strike CRACK.
  if (!st.bolts) st.bolts = [];
  if (_pendingStrikes.length && v.acX != null && !framed) {
    for (const s of _pendingStrikes) {
      const dist = Math.hypot(s.gx - v.acX, s.gy - v.acY);
      if (dist >= BOLT_MAX_DIST) continue;   // out of view — discard
      st.bolts.push(makeBolt(s.gx, s.gy, now, s.intensity));
      if (st.bolts.length > 6) st.bolts.shift();
      // A recorded thunderclap for a near strike, delayed by its distance (sound lags the flash);
      // the ambient storm thunder in engine-audio covers the rest, so only clap up close. Real
      // samples (not a synth noise burst, which read as static).
      if (dist < 30) {
        const near = clamp(1 - dist / 30, 0, 1);
        setTimeout(() => playThunderSample(0.28 + near * 0.5), Math.min(1400, dist * 40));
      }
    }
    _pendingStrikes.length = 0;
  }
  st.bolts = st.bolts.filter(b => now - b.t0 < b.dur);

  // Clouds — placed at REAL sky positions and projected through projSky, so the deck stays put in
  // the world and pans across the view (and off the compass) as you turn, instead of a flat
  // billboard spinning with the camera. When the weather FIELD is present each drifting cell is a
  // clump of sprites at its true bearing/elevation from the aircraft (fly toward a front and it
  // rises from the horizon and passes overhead); otherwise a light procedural fair-weather deck.
  // When the fly-through deck is live (forward world view), it OWNS the near clouds as true 3-D
  // puffs projected through the world camera below — so here the flat dome billboards keep only the
  // FAR fronts (a cloud line on the horizon) and cede everything within reach to the volumetric layer.
  const volOn = !framed && worldBlend > 0.02 && RENDER_TUNE.volClouds !== 0;
  const cloudy = wx === 'cloudy' || wx === 'rain' || wx === 'storm' || wx === 'snow' || wx === 'fog';
  const cloudAlpha = (wx === 'clear' ? 0.5 : cloudy ? 0.74 : 0.58) * (1 - sky.night * 0.4);
  let baseTint = cloudy ? [148, 156, 166] : mix([245, 248, 252], sky.hor, 0.22);
  let litTint = cloudy ? [190, 196, 204] : mix([255, 255, 255], sky.sun || [255, 250, 240], 0.28);
  if (localStorm > 0.02) { baseTint = mix(baseTint, [92, 98, 108], localStorm * 0.7); litTint = mix(litTint, [150, 156, 166], localStorm * 0.6); }   // darken under a storm/rain cell
  // Overcast CEILING — a thin, cheap full-sky layer for grey weather: one gradient wash (thicker
  // toward the horizon, where the line of sight cuts through more of the deck) veils the stars/sun,
  // then a few broad drifting patches give it uneven thickness so it isn't a dead flat fill. The
  // discrete puffs drawn below share this tint, so they read as denser knots WITHIN the ceiling
  // rather than lone blobs on open sky. Nearly free — a couple of gradient fills, no per-sprite work.
  const overcast = wx === 'cloudy' ? 0.9 : wx === 'fog' ? 0.82 : wx === 'storm' ? 0.85 : (wx === 'rain' || wx === 'snow') ? 0.7 : 0;
  if (overcast > 0.01 && !framed) {
    const ceil = mix(mix(baseTint, litTint, 0.4), [24, 26, 34], sky.night * 0.5);
    const wash = ctx.createLinearGradient(0, -H * 0.4, 0, horizonY);
    wash.addColorStop(0, rgb(ceil, overcast * 0.22)); wash.addColorStop(1, rgb(ceil, overcast * 0.42));   // thickens toward the horizon
    ctx.fillStyle = wash; ctx.fillRect(-OX, -H, ex, horizonY + H);
    const drift = ((vw.heading || 0) / 360) * W * 2.5;   // pans with the compass, like the clouds
    for (let i = 0; i < 4; i++) {
      const px = ((frac(i * 3.3) * 2 - 0.35) * W - drift * (0.4 + frac(i) * 0.5)) % (W * 2.4);
      const py = horizonY * (0.28 + frac(i * 1.7) * 0.5), pr = W * (0.4 + frac(i * 2.1) * 0.4);
      const pc = frac(i * 5.1) > 0.5 ? mix(ceil, litTint, 0.5) : mix(ceil, [18, 20, 28], 0.5);   // lighter thin spots / heavier lumps
      const g2 = ctx.createRadialGradient(px, py, pr * 0.1, px, py, pr);
      g2.addColorStop(0, rgb(pc, overcast * 0.14)); g2.addColorStop(1, rgb(pc, 0));
      ctx.fillStyle = g2; ctx.beginPath(); ctx.ellipse(px, py, pr, pr * 0.5, 0, 0, 7); ctx.fill();
    }
  }
  const drawList = [];
  if (st.cells && v.acX != null) {
    const ax = v.acX, ay = v.acY;
    for (const c of st.cells) {
      const stormy = c.type === 'storm' || c.type === 'precip';
      const sprites = Math.min(9, Math.max(3, Math.round(c.r * 0.7)));   // more sprites for a bigger cell
      for (let k = 0; k < sprites; k++) {
        // Scatter the cluster deterministically WITHIN the cell footprint (stable as it drifts).
        const rr = Math.sqrt(frac(c.seed + k * 1.7)) * c.r * 0.9, th = frac(c.seed + k * 3.3) * 6.2832;
        const wx0 = c.x + Math.cos(th) * rr, wy0 = c.y + Math.sin(th) * rr;
        const dx = wx0 - ax, dy = wy0 - ay, dist = Math.hypot(dx, dy);
        if (dist > 70) continue;                                          // far fronts fold into horizon haze, not sprites
        if (volOn && dist < 44) continue;                                 // near cells are the volumetric layer's job (fly-through) — dome keeps only the horizon line
        const az = Math.atan2(dx, -dy) * 180 / Math.PI;                   // compass bearing (north = -y)
        const el = Math.atan2(CLOUD_SKY_H, Math.max(0.6, dist)) * 180 / Math.PI;
        const p = projSky(az, el, vw.heading, W, horizonY, skyFL);
        if (!p.front) continue;
        const near = clamp(1 - dist / 40, 0.12, 1);
        const sz = (0.5 + frac(c.seed + k * 5.1) * 0.7) * (W * 0.06) * (0.6 + near * 1.4);
        drawList.push({ x: p.sx, y: p.sy, s: sz, a: cloudAlpha * clamp(c.intensity, 0.4, 1) * (0.5 + near * 0.6), el, stormy });
      }
    }
  } else {
    // No weather field → no fly-through cells; the procedural dome deck stands in (field-only).
    const cloudN = cloudy ? st.clouds.length : Math.ceil(st.clouds.length * 0.5);   // thinner deck in fair weather
    for (let i = 0; i < cloudN; i++) {
      const c = st.clouds[i];
      c.az = (c.az + (0.06 + speed * 0.25) * c.drift * dt) % 360;
      const p = projSky(c.az, c.el, vw.heading, W, horizonY, skyFL);
      if (!p.front) continue;
      const near = clamp(1 - c.el / 40, 0.2, 1);
      drawList.push({ x: p.sx, y: p.sy, s: c.s * (W * 0.06) * (0.7 + near * 0.9), a: cloudAlpha * (0.6 + near * 0.5), el: c.el, stormy: false });
    }
  }
  drawList.sort((a, b) => b.el - a.el);   // far (high) first, near (low) last
  for (const d of drawList) {
    const cx = d.x, cy = d.y, cs = d.s, a = d.a;
    const bt = d.stormy ? mix(baseTint, [78, 84, 94], 0.5) : baseTint, lt = d.stormy ? mix(litTint, [140, 146, 156], 0.5) : litTint;
    // grounding shadow first, then the feathered body
    ctx.fillStyle = rgb(mix(bt, [36, 40, 50], 0.55), a * 0.22);
    ctx.beginPath(); ctx.ellipse(cx + cs * 0.2, cy + cs * 0.52, cs * 1.7, cs * 0.26, 0, 0, 7); ctx.fill();
    // Directional light: bias each lobe's bright focus TOWARD the key light so the far horizon deck
    // is lit across its lobes (bright light-side, shaded far-side) rather than carrying a hard silver
    // rim. Same soft read as the near fly-through puffs.
    let lfx = 0, lfy = -0.35;
    if (lightStr > 0.02) { let lx = lightX - cx, ly = lightY - cy; const L = Math.hypot(lx, ly) || 1; lfx = lx / L * 0.4; lfy = ly / L * 0.4 - 0.1; }
    for (const [ox, oy, rr] of [[-cs * 1.1, 7, cs * 0.92], [-cs * 0.25, 1, cs * 1.28], [cs * 0.75, 6, cs * 0.9], [cs * 0.3, -9, cs * 0.78], [cs * 1.55, 10, cs * 0.6]]) {
      const rg = ctx.createRadialGradient(cx + ox + rr * lfx, cy + oy + rr * lfy, rr * 0.15, cx + ox, cy + oy, rr);
      rg.addColorStop(0, rgb(lt, a)); rg.addColorStop(0.5, rgb(bt, a * 0.9)); rg.addColorStop(1, rgb(bt, 0));
      ctx.fillStyle = rg; ctx.beginPath(); ctx.ellipse(cx + ox, cy + oy, rr, rr * 0.64, 0, 0, 7); ctx.fill();
    }
  }
  // High CIRRUS — thin, wispy horizontal streaks near the top of the sky (a different cloud TYPE
  // from the puffy cumulus). Faint and slow-drifting; only in fair / partly-cloudy skies, fading out at night.
  if (!framed && (wx === 'clear' || wx === 'cloudy') && worldBlend > 0.02) {
    if (!st.cirrus) st.cirrus = Array.from({ length: 9 }, (_, i) => ({ x: frac(i * 5.3), y: 0.05 + frac(i * 2.7) * 0.32, s: 0.6 + frac(i * 8.1) * 0.9, sp: 0.3 + frac(i * 1.9) * 0.5 }));
    const cirA = (wx === 'cloudy' ? 0.17 : 0.11) * (1 - sky.night * 0.7) * worldBlend;
    const cirTint = mix([255, 255, 255], sky.hor, 0.3);
    ctx.lineCap = 'round';
    for (const c of st.cirrus) {
      c.x = (c.x + (0.001 + speed * 0.012) * c.sp * dt) % 1.2;
      const cx = (c.x - 0.1) * W, cyy = c.y * horizonY, len = c.s * W * 0.22, thick = 2 + c.s * 3;
      for (let k = -1; k <= 1; k++) {   // a few stacked, feathering streaks
        const g = ctx.createLinearGradient(cx - len / 2, 0, cx + len / 2, 0);
        g.addColorStop(0, rgb(cirTint, 0)); g.addColorStop(0.5, rgb(cirTint, cirA * (1 - Math.abs(k) * 0.45))); g.addColorStop(1, rgb(cirTint, 0));
        ctx.strokeStyle = g; ctx.lineWidth = thick;
        ctx.beginPath(); ctx.moveTo(cx - len / 2, cyy + k * thick * 1.7); ctx.lineTo(cx + len / 2, cyy + k * thick * 1.7 - len * 0.03); ctx.stroke();
      }
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
  // Mode-7-inspired textured ground plane (grass/land tiles + relief + water) — faded in
  // by worldBlend so it crossfades against the airport/runway rather than popping in.
  // Drawn for the SIDE window too: the camera heading (vw) already carries the +90° side
  // yaw, so the ground renders correctly out the cabin window — without this the side view
  // left a flat colour band where the grass should be ("grass isn't showing").
  if (worldBlend > 0.02) {
    ctx.save(); ctx.globalAlpha = worldBlend;
    pBegin('ground');
    drawMode7Floor(ctx, W, H, horizonY, focal, vw, sky, gTop, now, sunFx, chase, hazeCeil(wx), st);
    pEnd();
    ctx.restore();
  }
  if (side) {
    // Side window: lateral hatching OVER the textured floor sells the ground rushing past
    // (forward motion) — the passenger's view stays perpendicular to travel the whole time,
    // never swapping to a forward look down the runway.
    ctx.strokeStyle = gridCol;
    for (let k = 0; k < 24; k++) {
      const f = ((k / 24) + st.sideScroll) % 1, x = -OX + f * ex;
      ctx.globalAlpha = 0.09 + speed * 0.2;
      ctx.beginPath(); ctx.moveTo(x, horizonY + depthGround * 0.03); ctx.lineTo(x - 46 - speed * 34, H); ctx.stroke();
    }
    for (let k = 1; k <= 5; k++) { const y = horizonY + depthGround * (k / 5) * (k / 5); ctx.globalAlpha = 0.06; ctx.beginPath(); ctx.moveTo(-OX, y); ctx.lineTo(W + OX, y); ctx.stroke(); }
    ctx.globalAlpha = 1;
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

  // Volumetric god-rays fanning down from a low sun (dawn/dusk); buildings drawn below
  // paint over them, so the rays read as sitting behind the skyline.
  if (rayStr > 0.01) drawGodRays(ctx, W, H, horizonY, sunSkyX, sunSkyY, sky.sun, rayStr);

  // Atmospheric precipitation (snow/rain/ash in the air) is drawn HERE — after the sky
  // and ground but BEFORE the world objects — so buildings pass in front of it and it
  // reads as falling out in the scene, not plastered on the glass ("snowing inside").
  // The close, on-the-canopy layer (drops + streaks) is drawGlass(), painted last.
  // When the weather field is plumbed, the precip is whatever cell we're inside (rain starts as
  // you fly into it, stops as you leave) rather than one global string. `precipLocal` overrides wx.
  pBegin('weather');
  drawWeather(ctx, W, H, wx, st, dt, speed, wxSample && wxSample.precip > 0.12 ? { type: wxSample.ptype, rate: wxSample.precip } : null);
  pEnd();

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
    // A frontier field (wastes/slag theme) flies off a packed-dirt strip, not tarmac — paint the
    // departure/approach backdrop as graded dirt to match the dust the Mode-7 world renders below.
    // A helipad has no runway to roll down — swap the strip for a circle-H pad.
    if (v.helipad) drawGroundHelipad(ctx, W, H, horizonY, depthGround, { roll: v.roll || 0, alt: height }, sky.night, reveal);
    else drawGroundRunway(ctx, W, H, horizonY, depthGround, { roll: v.roll || 0, alt: height }, st.scroll, sky.night, reveal, v.airport === 'wastes' || v.airport === 'slag');
  }
  // Enter for the PILOT's own scene always (even parked on the deck, worldBlend 0) so her shadow
  // and external-chase model still draw — and for the PASSENGER window only once the Mode-7 world
  // is fading in (worldBlend), same as before. The heavy WORLD layers (ground surfaces, buildings,
  // traffic) stay gated by worldBlend; only the own-ship shadow/model escape that gate.
  if (phase === 'vtol') {
    drawPad(ctx, W, H, horizonY, height, v.drift || 0);
  } else if (!framed || worldBlend > 0.02) {
    _obsHgt = clamp(v.height || 0, 0, 1);
    const cam = makeCam(W, horizonY, focal, vw, chase);
    // Textured 3-D world through the Mode-7 camera (roads/runway ground + extruded buildings),
    // faded in with worldBlend so it crossfades against the airport scenery above. On the deck
    // (worldBlend 0) it's the flat airport scenery that stands in, so these layers stay dark.
    if (worldBlend > 0.02) {
      ctx.save(); ctx.globalAlpha = worldBlend;
      pBegin('surfaces');
      drawGroundSurfaces(ctx, cam, vw, sky, now);
      pEnd();
      ctx.restore();
    }
    // Aircraft's own shadow — drawn AFTER the ground surfaces but BEFORE the buildings, and NOT
    // gated by worldBlend, so a parked craft reads as planted the instant you embark. `phase ===
    // 'ground'` is the authoritative weight-on-wheels signal (true from embark): planted ⇒ a soft
    // contact shadow FULL-strength directly beneath her; airborne ⇒ the sun-cast height cue. The
    // two cross-fade over the first bit of climb via `grounded`.
    if (!framed && !v.hideOwnShip) {
      const grounded = phase === 'ground' ? 1 : clamp(1 - height / 0.06, 0, 1);
      if (grounded > 0.01) drawGroundContactShadow(ctx, cam, v.heading, v.cls, grounded);
      if (sunFx.elev > 0.02 && grounded < 0.99) drawAircraftShadow(ctx, cam, height, sunFx, worldBlend, v.heading, v.cls);
    }
    // The Mode-7 world objects run EVEN on the deck (worldBlend 0) so the Echelon's hull stays drawn
    // while you're parked on her pad — she exists only in this pass, not the flat airport scene, and
    // must never blink in as you climb. Non-yacht objects self-cull at low worldBlend (their alpha
    // folds it in and drops below the draw threshold); only the yacht escapes it (see the alpha above).
    // The heavier atmospherics (lightning, clouds, traffic, guides) stay gated below.
    drawWorldObjects(ctx, cam, vw, sky, now, sunFx);
    if (worldBlend > 0.02) {
      if (st.bolts && st.bolts.length) drawLightning(ctx, cam, st, now, v.acX ?? 0, v.acY ?? 0);   // 3-D lightning bolts inside storm cells
      if (volOn) { pBegin('clouds'); drawVolumetricClouds(ctx, cam, st, v, baseTint, litTint, cloudAlpha, localStorm, sky.night, dt, W, H, horizonY, wx, lightX, lightY, lightStr); pEnd(); }   // fly-through cloud deck: puff stacks + silver-lining rim, value-noise mottle, inter-lobe AO, virga shafts + whiteout/haze (base at a realistic altitude for `wx`)
      if (sky.night > 0.35) drawSearchlights(ctx, cam, vw, now, worldBlend);   // sweeping beams from restricted (no-fly) blocks at night
      if (!framed) drawBirds(ctx, W, H, horizonY, vw, st, dt, speed, sky, now, worldBlend);   // ambient flock scattering as you pass
      if (vw.landGuide && vw.runway) drawGuideBoxes(ctx, cam, vw, now);
      if (vw.contacts) drawContacts(ctx, cam, vw, W, H, sunFx, now);   // air-to-air traffic (Phase A: see other craft)
      drawGunTracers(ctx, cam, v, now);   // 3D gun tracers — own rounds + any nearby shooter's, streaking through world space toward where they're aiming
      if (v.missiles) drawMissiles(ctx, cam, v, now);   // our own shots in the air: motor flare + smoke trail, weaving downrange
      // Incoming ground-AA volley in the same 3D world space, rising off the gun's tile.
      // Remembers whether it drew: a site behind the view (or an old payload without site
      // coords) falls through to the screen-space streak after the banked block instead.
      if (v.aaTracer && v.aaTracer.dx != null) v._aaDrew3D = drawAATracer3D(ctx, cam, v, now);
      if (v.fireworks) drawFireworks(ctx, cam, v, now);   // admin fireworks bursting over a world tile
      if (vw.apTarget) drawAirportTarget(ctx, cam, vw, W, H, now);   // target-field ring / Home waypoint
      if (vw.gates) drawGates(ctx, cam, vw, W, H, now);   // checkride pilot-wings rings
    }
    // External chase view: the OWN ship, projected through the very same chase camera as the
    // world (a real 3rd-person camera, not a sprite pasted on a cockpit view), at the craft's
    // eye-height with its gear swinging out/in.
    // `hideOwnShip` lets a non-aircraft chase (the Helm view watching the Echelon) borrow the
    // external orbit camera without pasting an aircraft at world origin — the yacht cell that
    // sits at the map-window centre renders as the framed subject instead.
    if (ext && !v.hideOwnShip) {
      pBegin('aircraft');
      const ownbb = drawAircraftModel(ctx, cam, { dx: 0, dy: 0, cls: v.cls, armed: !!v.armed, hdg: v.heading, bank: v.bank, pitch: v.pitch, livery: v.livery, sizeMul: OWN_EXT_MUL, gearAnim: v.gearAnim ?? 1, power: v.enginePct != null ? v.enginePct : v.speed, ctrl: v.ctrl, propPhase: v.propPhase, propSpin: v.propSpin, propDisc: v.propDisc, lights: v.engineOn !== false, landing: !!v.landingLight, breakup: v.breakup, noseVisor: v.noseVisor || 0 }, ownShipBaseWz(cam, v), sunFx, now);
      if (v.wreckFx && ownbb) drawWreckFire(ctx, ownbb, v.wreckFx, now);   // crash-cinematic fire + smoke over the burning wreck
      pEnd();
    }
    if (ext && v.reticle) drawGunReticle(ctx, cam, v, W, H, horizonY);   // two-part gunsight over the chase model
  }

  // Landing/taxi lamps out the windscreen: with the LIGHTS switch on at night the nose lamps
  // throw a warm-white flood onto the ground ahead — a bright pool plus twin feathered beams.
  // Inside the banked block so the throw rolls with the aircraft; brightens the darker it gets.
  if (v.landingLight && !framed && !ext && worldBlend > 0.05 && sky.night > 0.2)
    drawLandingBeam(ctx, W, H, horizonY, vx, sky.night, speed, now);

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

  // Lightning flash: a nearby strike floods the whole scene white for its brief life, scaled by how
  // close it hit. Drawn in screen space (over the world) so the whole canopy blooms with each bolt.
  if (st.bolts && st.bolts.length && !framed) {
    let flash = 0;
    for (const b of st.bolts) {
      const age = now - b.t0; if (age >= b.dur) continue;
      const prox = clamp(1 - Math.hypot(b.bx - (v.acX ?? 0), b.by - (v.acY ?? 0)) / 45, 0, 1);
      flash = Math.max(flash, prox * Math.max(0, 1 - age / b.dur) * (0.55 + 0.45 * Math.sin(age * 0.085)) * b.intensity);
    }
    if (flash > 0.02) { ctx.fillStyle = rgb([222, 234, 255], clamp(flash * 0.5, 0, 0.5)); ctx.fillRect(0, 0, W, H); }
  }

  // Region atmosphere grade — a place's cosmetic mood (e.g. The Reach's sun-baked dust), faded in
  // by how deep in the region you are. Over the world, under the canopy glass/prop overlays below.
  { const rg = regionGradeFor(v); if (rg) applyRegionGrade(ctx, W, H, horizonY, rg.g, rg.w, now, sky.night); }

  // Heat shimmer: the tarmac wavers in the hot air above the horizon (hot fields, high sun).
  if (shimmerStr > 0.01) drawHeatShimmer(ctx, cv, W, H, horizonY, dpr, now, shimmerStr);

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


  // Wingtip vapour streaming off the wings at speed / in a hard-G bank.
  if (vaporStr > 0.01) drawVaporTrails(ctx, W, H, horizonY, vaporStr, now);
  // Sun glare + lens flare across the canopy when the sun is in the field of view.
  if (glareStr > 0.01) drawLensFlare(ctx, W, H, sunFlareX, sunFlareY, sky.sun, glareStr);

  // Nose prop from the pilot's seat: the same rpm-driven disc the chase view paints, projected
  // head-on ahead of the nose so it shimmers in the forward windscreen (blades tick over at idle,
  // smear into a blur disc under power). Forward view only — a Q/E side-look becomes a framed
  // window (skipped) — and single centred nose-prop classes only (drawCockpitProp self-gates).
  // The prop is only a metre or two off the nose, so it reads BIG and CLOSE (radius ~ the whole
  // frame height) with its HUB dropped down into the cowl/glareshield — like a real GA cockpit,
  // you sit behind the disc and see only its top arc sweeping across the windscreen, never the
  // centre. Drawn before the glass overlays so on-glass weather and the cowl occlude the lower arc.
  if (!framed && !ext && !v.reticle && v.cls) {
    const rad = H * 0.62;
    const cowlTop = H - H * (COWL_DEPTH[v.cls] ?? COWL_DEPTH.default);
    drawCockpitProp(ctx, v.cls, { cx: W / 2, cy: cowlTop + rad * 0.16, rad,
      spin: v.propPhase || 0, disc: v.propDisc || 0, spool: v.propSpin || 0 });
  }

  // Canopy glass sheen — a soft diagonal reflection that slides a touch with bank.
  const sheen = ctx.createLinearGradient(0, 0, W, H);
  const so = clamp(0.5 + (v.bank || 0) / 120, 0.1, 0.9);
  sheen.addColorStop(clamp(so - 0.18, 0, 1), 'rgba(255,255,255,0)');
  sheen.addColorStop(so, 'rgba(255,255,255,0.06)');
  sheen.addColorStop(clamp(so + 0.18, 0, 1), 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen; ctx.fillRect(0, 0, W, H);
  // Instrument-panel glow reflected up onto the lower canopy at dusk/night.
  if (!framed && !ext && instrGlow > 0.02) drawInstrumentReflection(ctx, W, H, instrGlow, v.bank || 0, panelLit);
  // corner vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  // Hero-event colour cast over the whole scene — drawn after the vignette so it
  // grades the world AND the canopy, the way flying inside a chemical cloud
  // actually looks, and before the on-glass layer so the drops still read on top.
  if (wxEvent) {
    const [r, g, b] = WX_EVENT_CAST[wxEvent.type];
    const m = wxEvent.phase === 'peak' ? 1 : 0.5;
    ctx.fillStyle = `rgba(${r},${g},${b},${0.07 + 0.09 * m})`;
    ctx.fillRect(0, 0, W, H);
  }

  // On-glass weather (drops that cling to the canopy, lightning), bug splats + frost + a WX badge.
  // The on-glass layer still wants to know what's physically hitting the canopy:
  // acid rain is rain (beads, streaks, a glass that stays clean of bugs), an ion
  // storm is a storm (the lightning branch). The badge below keeps the real name.
  pBegin('glass');
  if (!ext) drawGlass(ctx, W, H, WX_EVENT_AS[wx] || wx, st, dt, speed, framed);
  pEnd();
  if (!v.windowClass && !ext) drawCanopy(ctx, W, H);   // DA62-style curved windscreen header (forward view)
  if (!v.windowClass && !ext) drawCowl(ctx, W, H, v.cls);   // nose cowl / glareshield along the bottom — hides the bare near-ground band without lifting the camera
  if (!v.windowClass) drawWxBadge(ctx, W, wx, v.wind);
  if (v.hud) drawHud(ctx, W, H, v);
  // Guns (Phase B): tracers are drawn as 3D world objects inside the banked world block
  // above (drawGunTracers) so they streak out with real depth toward the target.
  // Incoming ground-AA fire is 3D there too (drawAATracer3D, off the gun's actual tile);
  // this screen-space streak is the FALLBACK — fire from an emplacement behind the view
  // still reads and still gives a break direction.
  if (v.aaTracer && !v._aaDrew3D) drawAATracer(ctx, W, H, v);
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

// Nose cowl / glareshield across the BOTTOM of the forward view — the aircraft's own
// nose deck sitting in the near foreground, the way it does in a real cockpit. It
// occludes the bare near-ground band below the runway (which otherwise reads as
// "seeing through the floor") with the airframe itself, so the fix costs no camera
// lift. Depth + a shallow centre bump vary by class so each nose reads a little
// different: a bubble ultralight barely shows any cowl; a heavy freighter carries a
// broad glareshield; a gunship a flat armoured deck.
const COWL_DEPTH = { ultralight: 0.12, heli: 0.14, prop: 0.17, heavy: 0.22, gunship: 0.19, wreck: 0.16, default: 0.17 };
function drawCowl(ctx, W, H, cls) {
  const d = (COWL_DEPTH[cls] || COWL_DEPTH.default) * H;
  const yCorner = H - d;               // cowl top at the corners
  const yMid = yCorner - d * 0.30;     // a shallow nose bump at the centre (rises a touch higher)
  ctx.save();
  // Ambient-occlusion band on the glass just above the cowl — seats it into the scene
  // so its top edge isn't a hard cut against the ground.
  const ao = ctx.createLinearGradient(0, yMid - H * 0.11, 0, yMid + 4);
  ao.addColorStop(0, 'rgba(6,10,14,0)'); ao.addColorStop(1, 'rgba(6,10,14,0.34)');
  ctx.fillStyle = ao; ctx.fillRect(0, yMid - H * 0.11, W, H * 0.11 + 4);
  // Cowl body: full-width, top edge bowing up over the nose.
  ctx.beginPath();
  ctx.moveTo(0, H); ctx.lineTo(0, yCorner);
  ctx.quadraticCurveTo(W * 0.5, yMid, W, yCorner);
  ctx.lineTo(W, H); ctx.closePath();
  const g = ctx.createLinearGradient(0, yMid, 0, H);
  g.addColorStop(0, 'rgba(14,18,24,0.98)'); g.addColorStop(0.5, 'rgba(9,12,17,1)'); g.addColorStop(1, 'rgba(4,6,9,1)');
  ctx.fillStyle = g; ctx.fill();
  // Anti-glare ribs — two faint contours following the bow, for texture.
  ctx.strokeStyle = 'rgba(255,255,255,0.028)'; ctx.lineWidth = 1;
  for (let i = 1; i <= 2; i++) {
    const f = i / 3, yy = lerp(yCorner, H, f);
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.quadraticCurveTo(W * 0.5, yy - d * 0.30 * (1 - f), W, yy); ctx.stroke();
  }
  // Glareshield lip: the top edge catching sky light.
  ctx.beginPath(); ctx.moveTo(0, yCorner); ctx.quadraticCurveTo(W * 0.5, yMid, W, yCorner);
  ctx.strokeStyle = 'rgba(150,185,215,0.16)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
}


// ── Cinematic flourishes ──────────────────────────────────────────────────────
// A cluster of light-and-atmosphere touches, each self-contained and additive so
// they layer over the scene without disturbing the physics-driven render below.

// Volumetric god-rays: soft wedges of light fanning DOWN from a low sun (dawn/dusk),
// laid in the banked world frame (buildings drawn after occlude them). `sx,sy` is the
// sun in the pre-bank world frame.
function drawGodRays(ctx, W, H, horizonY, sx, sy, disc, str) {
  const col = disc || [255, 240, 210], n = 7;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const spread = i / (n - 1) - 0.5;            // -0.5..0.5 fan
    const ang = Math.PI / 2 + spread * 1.15;      // around straight-down
    const len = H * 1.25, wBase = W * (0.02 + 0.03 * (1 - Math.abs(spread) * 1.2));
    const ex = sx + Math.cos(ang) * len, ey = sy + Math.sin(ang) * len;
    const px = -Math.sin(ang), py = Math.cos(ang);   // wedge-width perpendicular
    const a = str * (0.055 + 0.05 * (1 - Math.abs(spread)));
    const g = ctx.createLinearGradient(sx, sy, ex, ey);
    g.addColorStop(0, rgb(col, a)); g.addColorStop(1, rgb(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(sx + px * wBase * 0.3, sy + py * wBase * 0.3);
    ctx.lineTo(sx - px * wBase * 0.3, sy - py * wBase * 0.3);
    ctx.lineTo(ex - px * wBase, ey - py * wBase);
    ctx.lineTo(ex + px * wBase, ey + py * wBase);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// Aurora / ash-glow: slow vertical light-curtains high in the night sky. Green-teal
// aurora on a clear night; a dull red-orange glow when an ash cloud hangs overhead.
function drawAurora(ctx, W, horizonY, now, sky, wx) {
  const ash = wx === 'ash', bands = 5;
  const topCol = ash ? [200, 90, 40] : [80, 220, 150];
  const botCol = ash ? [120, 44, 22] : [40, 130, 200];
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < bands; i++) {
    const drift = Math.sin(now * 0.00013 * (1 + i * 0.3) + i * 2.1);
    const cx = W * (0.5 + drift * 0.42) + i * W * 0.04 - W * 0.08;
    const bw = W * (0.10 + 0.05 * ((i * 7) % 3));
    const wob = 0.5 + 0.5 * Math.sin(now * 0.0004 + i);
    const a = sky.night * (0.05 + 0.055 * wob);
    const g = ctx.createLinearGradient(cx, 0, cx, horizonY * 0.75);
    g.addColorStop(0, rgb(topCol, 0)); g.addColorStop(0.4, rgb(topCol, a));
    g.addColorStop(0.75, rgb(botCol, a * 0.6)); g.addColorStop(1, rgb(botCol, 0));
    ctx.fillStyle = g; ctx.fillRect(cx - bw / 2, 0, bw, horizonY * 0.75);
  }
  ctx.restore();
}

// Sun glare + lens flare, screen-space over the canopy. `sx,sy` is the sun re-projected
// through the bank into screen coords; a main bloom + an anamorphic streak + a chain of
// ghost discs marching along the sun→screen-centre axis (the classic camera artifact).
function drawLensFlare(ctx, W, H, sx, sy, disc, str) {
  const col = disc || [255, 240, 210], cx = W / 2, cy = H / 2;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  let g = ctx.createRadialGradient(sx, sy, 0, sx, sy, W * 0.30);
  g.addColorStop(0, rgb(col, 0.5 * str)); g.addColorStop(0.22, rgb(col, 0.16 * str)); g.addColorStop(1, rgb(col, 0));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createLinearGradient(sx - W * 0.5, sy, sx + W * 0.5, sy);
  g.addColorStop(0, rgb(col, 0)); g.addColorStop(0.5, rgb(mix(col, [255, 255, 255], 0.4), 0.22 * str)); g.addColorStop(1, rgb(col, 0));
  ctx.fillStyle = g; ctx.fillRect(0, sy - 2.5, W, 5);
  const dx = cx - sx, dy = cy - sy;
  const ghosts = [[-0.32, 0.05, [180, 200, 255]], [0.28, 0.03, [255, 220, 180]], [0.55, 0.06, col], [0.92, 0.085, [200, 255, 220]], [1.25, 0.045, [255, 200, 210]]];
  for (const [t, rr, c2] of ghosts) {
    const px = sx + dx * t, py = sy + dy * t;
    if (px < -W * 0.2 || px > W * 1.2) continue;
    const r = W * rr, rg = ctx.createRadialGradient(px, py, 0, px, py, r);
    rg.addColorStop(0, rgb(c2, 0.16 * str)); rg.addColorStop(0.6, rgb(c2, 0.05 * str)); rg.addColorStop(1, rgb(c2, 0));
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
  }
  ctx.restore();
}

// Wingtip vapour: vortices streaming off the wingtips — a light contrail at speed, thick
// vapour cones in a hard-G bank. Two procedural ribbons trailing from the lower corners,
// their puffs animated so they appear to stream backward.
function drawVaporTrails(ctx, W, H, horizonY, str, now) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const vy = H * 0.80;
  for (const side of [-1, 1]) {
    const ax = W * (0.5 + side * 0.40), ex = W * (0.5 + side * 0.62), ey = H * 1.05;
    const puffs = 10;
    for (let i = 0; i < puffs; i++) {
      const ph = ((i / puffs) + now * 0.0006 * (2 + str * 3)) % 1;
      const x = lerp(ax, ex, ph), y = lerp(vy, ey, ph);
      const r = (3 + ph * 16) * (0.5 + str), a = str * 0.10 * (1 - ph);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(235,242,255,${a})`); g.addColorStop(1, 'rgba(235,242,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
  }
  ctx.restore();
}

// Heat shimmer: the tarmac wavers in the hot air just above the horizon. A true
// refraction — thin rows of the already-drawn scene re-sampled from the canvas with a
// travelling horizontal wobble that grows toward the foreground. `cv` is the canvas
// element (device pixels); the live ctx is dpr-scaled, hence the ×dpr on the source.
function drawHeatShimmer(ctx, cv, W, H, horizonY, dpr, now, str) {
  const bandTop = Math.max(0, horizonY - H * 0.02);
  const bandH = Math.min(H - bandTop, H * 0.34);
  if (bandH <= 0) return;
  const rows = 34, rh = bandH / rows;
  for (let i = 0; i < rows; i++) {
    const y = bandTop + i * rh, depth = i / rows;
    const amp = str * (1.4 + depth * 5.5);
    const off = Math.sin(now * 0.004 + i * 0.7) * amp + Math.sin(now * 0.0027 + i * 1.9) * amp * 0.5;
    ctx.drawImage(cv, 0, y * dpr, W * dpr, rh * dpr + 1, off, y, W, rh + 1);
  }
}

// Instrument-panel glow reflected up onto the lower canopy at dusk/night — a faint wash
// plus a couple of coloured glints (cyan gauge, amber warning) that slide with bank. With the
// PANEL switch lit (`panel`), a richer warm backlight blooms up + a bright glareshield rim
// catches along the top of the dash — the "instruments lit" special-touch cabin ambience.
function drawInstrumentReflection(ctx, W, H, glow, bank, panel) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(0, H, 0, H * 0.55);
  g.addColorStop(0, `rgba(70,150,180,${0.10 * glow})`); g.addColorStop(1, 'rgba(70,150,180,0)');
  ctx.fillStyle = g; ctx.fillRect(0, H * 0.5, W, H * 0.5);
  const slide = clamp(bank / 60, -1, 1) * W * 0.12;
  // Coloured gauge glints — brighter and a touch bloomier with the panel lights on.
  const gaugeA = panel ? 0.17 : 0.10;
  for (const [fx, col] of [[0.32, [90, 200, 220]], [0.68, [230, 170, 90]]]) {
    const x = W * fx - slide, y = H * 0.92, r = W * (panel ? 0.19 : 0.16);
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, rgb(col, gaugeA * glow)); rg.addColorStop(1, rgb(col, 0));
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  if (panel) {
    const warm = [255, 208, 142];
    // 1) Warm even backlight pooling up from the lit dash onto the lower canopy.
    const wg = ctx.createLinearGradient(0, H, 0, H * 0.6);
    wg.addColorStop(0, rgb(warm, 0.16 * glow)); wg.addColorStop(1, rgb(warm, 0));
    ctx.fillStyle = wg; ctx.fillRect(0, H * 0.56, W, H * 0.44);
    // 2) A soft central hotspot where the main stack faces the glass.
    const cx = W * 0.5 - slide * 0.4, cy = H * 0.98, cr = W * 0.36;
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
    cg.addColorStop(0, rgb(warm, 0.13 * glow)); cg.addColorStop(1, rgb(warm, 0));
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, cr, 0, 7); ctx.fill();
    // 3) Glareshield rim catch — a thin bright line where the lit dash meets the windscreen.
    const edgeY = H * 0.88;
    const eg = ctx.createLinearGradient(0, edgeY - 7, 0, edgeY + 7);
    eg.addColorStop(0, rgb(warm, 0)); eg.addColorStop(0.5, rgb(warm, 0.11 * glow)); eg.addColorStop(1, rgb(warm, 0));
    ctx.fillStyle = eg; ctx.fillRect(0, edgeY - 7, W, 14);
  }
  ctx.restore();
}

// Landing/taxi lamps: with the LIGHTS switch on at night, twin lamps in the nose throw a
// warm-white flood onto the ground ahead — a bright pool out in the near-mid field plus two
// feathered vertical beams (twin lamps) reaching toward the horizon. Called inside the banked
// world block so the throw rolls with the aircraft; strength ramps up the darker it gets, and a
// faint filament shimmer keeps it alive. Additive, so it lifts whatever ground/buildings it lands on.
function drawLandingBeam(ctx, W, H, horizonY, vx, night, speed, now) {
  const str = clamp((night - 0.2) / 0.8, 0, 1);
  if (str < 0.02) return;
  const flick = 0.9 + 0.1 * Math.sin(now * 0.02) * Math.sin(now * 0.031);   // filament shimmer
  const warm = [255, 244, 214];
  const depth = Math.max(1, H - horizonY);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // 1) Twin feathered beams — two tall, narrow light columns off the nose lamps.
  for (const off of [-0.55, 0.55]) {
    const bx = vx + off * W * 0.11, by = horizonY + depth * 0.52, br = depth * 0.66;
    ctx.save();
    ctx.translate(bx, by); ctx.scale(0.34, 1);
    const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, br);
    bg.addColorStop(0, rgb(warm, 0.16 * str * flick)); bg.addColorStop(1, rgb(warm, 0));
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(0, 0, br, 0, 7); ctx.fill();
    ctx.restore();
  }
  // 2) The pool on the ground ahead — a wide, soft ellipse the beams converge onto.
  const poolY = horizonY + depth * 0.64, poolR = W * 0.44;
  ctx.save();
  ctx.translate(vx, poolY); ctx.scale(1, (depth * 0.5) / poolR);
  const pg = ctx.createRadialGradient(0, 0, 0, 0, 0, poolR);
  pg.addColorStop(0, rgb(warm, 0.28 * str * flick)); pg.addColorStop(0.5, rgb(warm, 0.11 * str * flick)); pg.addColorStop(1, rgb(warm, 0));
  ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(0, 0, poolR, 0, 7); ctx.fill();
  ctx.restore();
  ctx.restore();
}

// City-light bloom: at night, a warm halo over each near building's lit face, so the
// amber windows baked into the wall texture read as actually emitting light.
function drawCityBloom(ctx, cam, dx, dy, h, night, alpha) {
  const c = cam.proj(dx, dy, h * 0.55);
  if (c.f <= 0.25 || c.f > 8) return;
  const prox = clamp(1 - c.f / 8, 0, 1), r = clamp(150 / c.f, 8, 70);
  const a = night * alpha * (0.04 + 0.09 * prox);
  emitFace(decoDepth(c.f), () => {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(c.sx, c.sy, 0, c.sx, c.sy, r);
    g.addColorStop(0, `rgba(255,206,132,${a})`); g.addColorStop(0.55, `rgba(255,176,96,${a * 0.4})`); g.addColorStop(1, 'rgba(255,176,96,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.sx, c.sy, r, 0, 7); ctx.fill();
    ctx.restore();
  });
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
      // Sheet-glow biased to the upper sky: even when the bolt is off-screen, the storm
      // behind the skyline lights up (distant cloud-to-cloud lightning).
      const sheet = ctx.createLinearGradient(0, 0, 0, H * 0.6);
      sheet.addColorStop(0, `rgba(226,236,255,${st.flash * 0.28})`); sheet.addColorStop(1, 'rgba(226,236,255,0)');
      ctx.fillStyle = sheet; ctx.fillRect(0, 0, W, H * 0.6);
      if (st.bolt && st.flash > 0.4) {
        ctx.strokeStyle = `rgba(240,248,255,${st.flash})`; ctx.lineWidth = 2; ctx.shadowColor = 'rgba(200,224,255,0.9)'; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.moveTo(st.bolt[0][0] * W, 0); for (const [px, py] of st.bolt) ctx.lineTo(px * W, py * H); ctx.stroke(); ctx.shadowBlur = 0;
      }
    }
  }
}

const WX_LABEL = { rain: '☔ RAIN', storm: '⛈ STORM', snow: '❄ SNOW', ash: '⛆ ASHFALL', dust: '⛆ DUST', fog: '🌫 FOG', cloudy: '☁ OVERCAST', clear: '☀ CLEAR',
  acid_rain: '☣ ACID RAIN', ion_storm: '⚡ ION STORM' };
// Hero events read in the same alarm colour as a storm — the badge is the pilot's
// one-glance answer to "what am I actually flying through".
const WX_ALARM = new Set(['storm', 'acid_rain', 'ion_storm']);
function drawWxBadge(ctx, W, wx, wind) {
  const label = WX_LABEL[wx] || (wx ? wx.toUpperCase() : 'CLEAR');
  const txt = wind ? `${label}  ${Math.round(wind)}kt` : label;
  ctx.font = '10px monospace'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(txt).width + 14, x = W - w - 8, y = 8, h = 17;
  ctx.fillStyle = 'rgba(6,12,18,0.6)'; ctx.strokeStyle = 'rgba(143,208,255,0.35)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, 4) : ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke();
  ctx.fillStyle = WX_ALARM.has(wx) ? '#ffcf3e' : '#a9d4ec'; ctx.textAlign = 'left';
  ctx.fillText(txt, x + 7, y + h / 2 + 0.5); ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}

// Forward-view HUD (opt-in via v.hud): a sliding heading tape across the top with N/E/S/W
// letters + a fixed centre caret/readout.
const HDG_NAMES = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
// A boxed primary readout (IAS/ALT): small caption top-left, big value right-aligned, optional
// sub-line (e.g. a V/S trend) under the caption. warn recolours the frame + value when set.
function bigReadout(ctx, x, y, w, h, label, val, col, warn, sub) {
  ctx.fillStyle = 'rgba(6,12,18,0.78)'; ctx.strokeStyle = warn || col; ctx.lineWidth = warn ? 1.6 : 1;
  ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = warn || col; ctx.font = '6px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(label, x + 3, y + 2);
  if (sub) { ctx.fillStyle = '#9fd0ec'; ctx.font = '6px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(sub, x + 3, y + h - 2); }
  ctx.fillStyle = warn || '#eaf6ff'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText(val, x + w - 3, y + h / 2 + 1);
}
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
  // Big IAS (left) + ALT (right) readouts flanking the heading box — the two primary numbers, boxed
  // large so airspeed and altitude are legible at a glance on every craft's forward view. A red IAS
  // frame warns of the never-exceed redline (or a slow-flight edge below the heli's/wing's floor).
  if (v.ias != null || v.alt != null) {
    const boxY = tapeY + tapeH + 5, bw = 50, bh = 22, gap = 8;
    const fast = v.vne && v.ias >= v.vne * 0.95, slow = v.vs0 && v.ias < v.vs0;   // vs0 doubles as the heli ETL floor
    bigReadout(ctx, cx - 13 - gap - bw, boxY, bw, bh, 'IAS·kt', String(Math.max(0, Math.round(v.ias || 0))), '#5fe0a0', fast ? '#ff5a5b' : slow ? '#ffb23e' : null);
    // ALT box carries a small climb/descent arrow + fpm so vertical trend reads without the tape.
    const vs = Math.round(v.vsi || 0), trend = vs > 40 ? '▲' : vs < -40 ? '▼' : '·';
    bigReadout(ctx, cx + 13 + gap, boxY, bw, bh, 'ALT·ft', String(Math.round(v.alt || 0)), '#7ec8ff', null, `${trend}${Math.abs(vs)}`);
  }
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
function drawGroundRunway(ctx, W, H, horizonY, depth, rw, scroll, night, outerFade = 1, dust = false) {
  const roll = rw.roll || 0, alt = clamp(rw.alt || 0, 0, 1);
  // A long strip so it doesn't "run out" during the roll; the recede is driven mainly
  // by ALTITUDE (you keep seeing runway ahead until you climb high enough), while roll
  // only slides the near threshold slowly under/behind you.
  const RWL = RENDER_TUNE.rwl, VR = 1.9, cx = W / 2;
  // Persist while you're low/rolling OVER the strip — `outerFade` (the reveal crossfade) already
  // fades it out as you actually climb away, so the inner alt/roll terms only need to be gentle;
  // a steep inner fade was making the runway vanish out from under you the moment you lifted.
  const fade = clamp(1.85 - alt * 1.0 - Math.max(0, roll - RWL) * 0.2, 0, 1) * outerFade;
  if (fade <= 0.01) return;
  const eff = (d) => d - alt * RENDER_TUNE.rwyRecede;     // climbing pushes it DOWN and off the bottom (passes under you)
  const e = (d) => clamp(eff(d) / VR, -0.6, 1);          // clamp at 1 so the far end never rises past the horizon
  const projY = (d) => horizonY + depth * (1 - e(d));    // e<0 → below the bottom edge (behind/under us)
  const wid = (d) => (W * 0.36) * clamp(1 - eff(d) / VR, 0.04, 1.4);
  const nearD = -roll * 0.6, farD = RWL - roll * 0.6;
  if (eff(farD) < -0.2) return;                           // whole strip is behind/under us
  const nY = projY(nearD), fY = projY(farD), nW = wid(nearD), fW = wid(farD);
  ctx.save(); ctx.globalAlpha = fade;
  ctx.fillStyle = dust ? 'rgba(58,46,28,0.95)' : 'rgba(20,22,26,0.95)';
  ctx.beginPath(); ctx.moveTo(cx - nW, nY); ctx.lineTo(cx + nW, nY); ctx.lineTo(cx + fW, fY); ctx.lineTo(cx - fW, fY); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = dust ? 'rgba(150,124,74,0.6)' : 'rgba(220,232,214,0.8)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx - nW, nY); ctx.lineTo(cx - fW, fY); ctx.moveTo(cx + nW, nY); ctx.lineTo(cx + fW, fY); ctx.stroke();
  if (dust) {
    // Packed-dirt strip: no paint, no PAPI, no edge lights — just two wheel-rut lines scrolling
    // under you. Bail before the painted-tarmac markings so a frontier strip reads as beaten dirt.
    ctx.strokeStyle = 'rgba(70,54,30,0.75)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (const s of [-0.34, 0.34]) { ctx.beginPath(); ctx.moveTo(cx + nW * s, nY); ctx.lineTo(cx + fW * s, fY); ctx.stroke(); }
    ctx.restore(); return;
  }
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

// The WORLD-ground counterpart of drawGroundRunway for a VTOL-only field: a square
// apron with the standard circle-H, laid on the ground ahead of you and receding as
// you climb away. Same projection maths as the runway (so the two read as the same
// world), but there's nothing to roll down — a helipad is a spot, not a strip, so
// `roll` only nudges it rather than scrolling a centreline past you.
function drawGroundHelipad(ctx, W, H, horizonY, depth, rw, night, outerFade = 1) {
  const roll = rw.roll || 0, alt = clamp(rw.alt || 0, 0, 1);
  const VR = 1.9, cx = W / 2;
  const fade = clamp(1.85 - alt * 1.0, 0, 1) * outerFade;
  if (fade <= 0.01) return;
  const eff = (d) => d - alt * RENDER_TUNE.rwyRecede;
  const e = (d) => clamp(eff(d) / VR, -0.6, 1);
  const projY = (d) => horizonY + depth * (1 - e(d));
  const wid = (d) => (W * 0.30) * clamp(1 - eff(d) / VR, 0.04, 1.4);

  // The pad sits just ahead of the parking spot and drifts back under you on a
  // vertical departure. Square-ish in plan: near edge wider than the far edge.
  const nearD = 0.15 - roll * 0.5, farD = 1.35 - roll * 0.5;
  if (eff(farD) < -0.2) return;
  const nY = projY(nearD), fY = projY(farD), nW = wid(nearD), fW = wid(farD);
  const midY = (nY + fY) / 2, midW = (nW + fW) / 2;

  ctx.save(); ctx.globalAlpha = fade;
  // Apron slab
  ctx.fillStyle = 'rgba(24,26,30,0.95)';
  ctx.beginPath(); ctx.moveTo(cx - nW, nY); ctx.lineTo(cx + nW, nY); ctx.lineTo(cx + fW, fY); ctx.lineTo(cx - fW, fY); ctx.closePath(); ctx.fill();
  // Painted border of the pad square
  ctx.strokeStyle = 'rgba(226,236,220,0.75)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - nW * 0.94, nY); ctx.lineTo(cx + nW * 0.94, nY); ctx.lineTo(cx + fW * 0.94, fY); ctx.lineTo(cx - fW * 0.94, fY); ctx.closePath(); ctx.stroke();

  // Touchdown circle — an ellipse because we're looking at it in perspective.
  const rx = midW * 0.62, ry = Math.max(3, (nY - fY) * 0.30);
  ctx.strokeStyle = 'rgba(236,240,226,0.9)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(cx, midY, rx, ry, 0, 0, 7); ctx.stroke();

  // The H, drawn as three foreshortened bars so it lies flat ON the pad rather
  // than standing up like a billboard (see the surface-text rule in the render docs).
  const hw = rx * 0.46, hh = ry * 0.92, bar = Math.max(2, rx * 0.15);
  ctx.fillStyle = 'rgba(236,240,226,0.92)';
  ctx.fillRect(cx - hw - bar / 2, midY - hh, bar, hh * 2);   // left upright
  ctx.fillRect(cx + hw - bar / 2, midY - hh, bar, hh * 2);   // right upright
  ctx.fillRect(cx - hw, midY - bar / 2, hw * 2, bar);        // crossbar

  // Perimeter lights — green pad lighting, warm and brighter at night.
  const lit = night > 0.35;
  ctx.fillStyle = lit ? 'rgba(120,255,190,0.95)' : 'rgba(150,190,170,0.55)';
  for (let k = 0; k <= 6; k++) {
    const f = k / 6, y = lerp(fY, nY, f * f), w2 = lerp(fW, nW, f * f) * 0.94;
    const r = 1 + f * 1.6;
    ctx.beginPath(); ctx.arc(cx - w2, y, r, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + w2, y, r, 0, 7); ctx.fill();
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

// Smooth 2-D value noise in world-tile space (deterministic; reuses the `frac` hash). 0..1.
function vnoise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a, b) => frac(a * 157.31 + b * 113.7);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Approximate Euclidean distance to the nearest seeded cell (two-pass chamfer). seed[y][x]
// truthy marks a source; returns { d, sy } — the distance grid (0 on sources, growing outward)
// and, per cell, the ROW of the nearest source (sy), so callers can tell which DIRECTION the
// nearest feature lies in (used to keep off-map sea a northern-only extension — see fillOffMap).
function distField(seed, mw, mh) {
  const INF = 1e9, D1 = 1, D2 = 1.4142, d = new Array(mh), sy = new Array(mh);
  for (let y = 0; y < mh; y++) {
    d[y] = new Float64Array(mw); sy[y] = new Float64Array(mw);
    for (let x = 0; x < mw; x++) { const s = !!seed[y][x]; d[y][x] = s ? 0 : INF; sy[y][x] = s ? y : INF; }
  }
  // Relax cell (y,x) against neighbour (ny,nx): if going through it is shorter, adopt its
  // distance-plus-step AND inherit its nearest-source row, so sy tracks alongside d.
  const relax = (y, x, ny, nx, cost) => { const nd = d[ny][nx] + cost; if (nd < d[y][x]) { d[y][x] = nd; sy[y][x] = sy[ny][nx]; } };
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    if (y > 0) { relax(y, x, y - 1, x, D1); if (x > 0) relax(y, x, y - 1, x - 1, D2); if (x < mw - 1) relax(y, x, y - 1, x + 1, D2); }
    if (x > 0) relax(y, x, y, x - 1, D1);
  }
  for (let y = mh - 1; y >= 0; y--) for (let x = mw - 1; x >= 0; x--) {
    if (y < mh - 1) { relax(y, x, y + 1, x, D1); if (x < mw - 1) relax(y, x, y + 1, x + 1, D2); if (x > 0) relax(y, x, y + 1, x - 1, D2); }
    if (x < mw - 1) relax(y, x, y, x + 1, D1);
  }
  return { d, sy };
}

// The wildlands & sea beyond the built map. Off-map/unbuilt tiles used to read as endless open
// ocean; instead we EXTEND the world's edge. Two distance fields — to the nearest built WATER and
// the nearest built LAND — classify every empty cell as sea or land, and the divide is wobbled by
// low-freq noise so the coastline is irregular (not a clean offset of the ragged built edge).
// Sea is deliberately NORTH-ONLY: a cell only extends to water when the nearest built water lies to
// its south (it's offshore, north of the bay). So the bay runs out to the northern horizon, while
// inland rivers/canals — and everything to the WEST, EAST and SOUTH — stay dry wildlands forever.
//   · sea  → open water (waves/glint carry the coastline read out to the horizon)
//   · land → the arid wildlands: DIRT at the shore giving way to rust-RED ROCK the deeper it runs,
//            broken up by noise so the transition isn't a clean band (matches the biomes beyond the
//            Curtain). It runs on infinitely; the sampler clamps to the window edge for the horizon.
// A window with no built tile at all inherits the craft's last land/sea memory (st.offLand): over
// open sea it stays ocean; deep past a land edge the wildlands run on instead of flipping to ocean.
const COAST_WOBBLE = 6, DIRT = BIOME_GROUND.badlands, REDROCK = BIOME_GROUND.redrock, SEA = [BIOME_GROUND.water[0], BIOME_GROUND.water[1], BIOME_GROUND.water[2], 1, 0, 1];
// Shoreline latitude: only built water NORTH of this world-row is the BAY (a genuine sea source that
// extends off-map to the horizon). The bay's southern frontier tops out around y≈908, so this sits
// just south of it. Inland water south of the line — the N–S canals, rivers and ponds threading the
// city — is deliberately NOT a sea source: it must not seed the off-map sea field (rivers "running on"
// past the west edge) nor flip the craft's land/sea memory to sea (open ocean bleeding in behind them).
// Same world-pinned assumption as the rest of this function ("the bay sits at low y, sea is north-only").
const BAY_SHORE_Y = 910;
function fillOffMap(LUT, mw, mh, R, wcx, wcy, litX, litY, wildOut, st = null) {
  const water = new Array(mh), land = new Array(mh);
  let anyBuilt = false;
  for (let y = 0; y < mh; y++) {
    water[y] = new Uint8Array(mw); land[y] = new Uint8Array(mw);
    for (let x = 0; x < mw; x++) {
      const c = LUT[y][x];
      if (!c) continue;
      anyBuilt = true;
      // Only the northern bay seeds off-map sea; inland water (south of the shore) is neither a sea
      // nor a land source, so the wildlands run on around it instead of it dragging ocean off-map.
      if (c[3] > 0.5) { if (((y - R) + wcy) <= BAY_SHORE_Y) water[y][x] = 1; }
      else land[y][x] = 1;   // c[3] = waterness
    }
  }
  // Deep off-map: no built tile is in view at all (flown >36 tiles past the whole city). The window
  // can't tell land from sea by distance-field, so it used to blanket-fill open ocean — which flipped
  // the arid wildlands to sea the moment the last building dropped off the far window edge. Instead
  // inherit `st.offLand`, a smoothed 0..1 memory of whether the craft's ground point was over land the
  // last time any tile WAS built: land → run the wildlands on to the horizon; sea (or unknown) → ocean.
  if (!anyBuilt) {
    if (!st || (st.offLand ?? 0) <= 0.5) return LUT;   // over open sea, or no memory yet → ocean fallback (unchanged)
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      const awx = (x - R) + wcx, awy = (y - R) + wcy;
      const rr = clamp(0.55 + vnoise2(awx * 0.06, awy * 0.06) * 0.6 - 0.15, 0, 1);   // deep out reads mostly rust mesa, noise-mottled
      const col = mix(DIRT, REDROCK, rr);
      LUT[y][x] = [col[0], col[1], col[2], 0, 0, reliefShade(awx, awy, litX, litY, 1)];
      if (wildOut) wildOut[y][x] = rr < 0.45 ? 'scrub' : 'redrock';
    }
    return LUT;
  }
  const fW = distField(water, mw, mh), fL = distField(land, mw, mh);
  const dW = fW.d, dL = fL.d, wSrcY = fW.sy;   // wSrcY[y][x] = row of the nearest built water
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    if (LUT[y][x]) continue;                                  // a real built tile keeps its material
    const awx = (x - R) + wcx, awy = (y - R) + wcy;           // absolute world tile
    const wob = ((vnoise2(awx * 0.09, awy * 0.09) - 0.5) + (vnoise2(awx * 0.23, awy * 0.23) - 0.5) * 0.45) * COAST_WOBBLE;
    // Sea is a NORTHERN feature only (the bay sits at low y). Extend water off-map ONLY where the
    // nearest built water lies to this cell's SOUTH (wSrcY > y + wob — i.e. you're genuinely
    // offshore, north of a water body; the same coast-wobble noise ragged-izes this clip so the
    // E/W cutoff reads as a natural shore, not hard tile-row steps).
    // That keeps the coast running out to the horizon north of the bay, but
    // stops rivers/canals/ponds on the WEST and EAST (whose water sits level with or south of you)
    // from flooding the off-map — the wildlands run on as land forever to the sides and south.
    // (Open ocean far to the north, past the last built tile, is still held by st.offLand memory.)
    if (dW[y][x] + wob < dL[y][x] && wSrcY[y][x] > y + wob) { LUT[y][x] = SEA; if (wildOut) wildOut[y][x] = 'sea'; continue; }
    // Land: dirt→redrock, redder the farther out (dL = tiles past the built land edge) + noise mottle.
    const into = clamp((dL[y][x] - 1) / 26, 0, 1);
    const rr = clamp(into * 0.7 + vnoise2(awx * 0.06, awy * 0.06) * 0.6 - 0.15, 0, 1);
    const col = mix(DIRT, REDROCK, rr);
    const shade = reliefShade(awx, awy, litX, litY, 1);   // off-map plain is arid by construction → carved badland relief
    LUT[y][x] = [col[0], col[1], col[2], 0, 0, shade];
    if (wildOut) wildOut[y][x] = rr < 0.45 ? 'scrub' : 'redrock';   // hand the object pass a matching scatter biome (dirt shore → scrub, rust deep → redrock mesa)
  }
  // Remember whether the craft's ground point is over land vs water (now that the centre cell is
  // resolved, on- or off-map), smoothed across frames so a fully-empty window can inherit it above.
  if (st) {
    const ci = Math.round(R), cc = LUT[ci] && LUT[ci][ci];
    // Only the northern bay reads as "over sea"; crossing an inland river/canal (south of the shore)
    // must NOT flip the memory, or the deep-off-map fallback would paint ocean once you've passed it.
    const centerLand = cc ? ((cc[3] > 0.5 && ((ci - R) + wcy) <= BAY_SHORE_Y) ? 0 : 1) : (st.offLand ?? 0);
    st.offLand = st.offLand == null ? centerLand : st.offLand + (centerLand - st.offLand) * 0.12;
  }
  return LUT;
}

function drawMode7Floor(ctx, W, H, horizonY, depth, v, sky, gTop, now, sun, chase, hazeMax = 0.32, st = null) {
  v._wildFill = null;   // per-tile gap classification (sea|scrub|redrock) for drawWorldObjects; set once the LUT is built
  if (depth <= 2) return;
  // AUTHENTIC Mode 7: sample the ground PER PIXEL into a low-res buffer, then blit it
  // up with nearest-neighbour — that's the chunky, shimmering look, most visible when
  // you turn (the whole textured plane rotates around you). Each texel samples the
  // biome ahead from the map window + a world-space terrain texture + distance haze.
  // Eye height grows with altitude → the ground spreads and falls away as you climb.
  const DS = Math.max(1, Math.round(RENDER_TUNE.pixel || 4) + PERF_DS);   // downscale = pixel chunkiness (+PERF_DS = adaptive load-shed on this fixed-cost software raster)
  const X0 = -W, spanX = 3 * W;
  const bw = Math.max(2, Math.ceil(spanX / DS)), bhMax = Math.max(2, Math.ceil(H / DS));
  const buf = m7buf(bw, bhMax), data = buf.img.data;
  // Top of the ON-SCREEN ground. In a steep look-DOWN chase the horizon sits ABOVE the canvas
  // (horizonY < 0); starting the buffer at the real horizon then burns all its rows on the
  // off-screen slab above y=0, and the fixed-height buffer runs out before the screen bottom —
  // leaving a gap that showed the flat ground-gradient beneath ("a hole under the aircraft").
  // Clamp the buffer's top to y=0 so its rows always span the visible ground down to the bottom;
  // the depth mapping below still references the TRUE horizonY, so perspective is unchanged.
  const yTop = Math.max(0, horizonY);
  const Y1 = H + depth * 0.3;
  const usedH = Math.min(bhMax, Math.max(1, Math.ceil((Y1 - yTop) / DS)));
  const EH = Math.max(0.05, RENDER_TUNE.eh + (v.height || 0) * RENDER_TUNE.climbLift + (chase ? chase.up : 0));   // additive + floor: altitude adds real eye-height so you climb above buildings; chase.up lifts the external camera above the craft; the floor wraps the sum so a low vertical orbit can't sink the camera below the terrain
  const hd = (v.heading || 0) * Math.PI / 180, sinh = Math.sin(hd), cosh = Math.cos(hd);
  const off = v.mapOffset, back = chase ? chase.back : 0;
  const ax = (off ? off.x : 0) - back * sinh, ay = (off ? off.y : 0) + back * cosh;   // external view: sample from `back` tiles behind the craft
  const map = v.map, R = map ? (map.length - 1) / 2 : 0;
  const cx = W / 2, halfW = W / 2, LAT = 1.15, FREQ = RENDER_TUNE.tile;
  const nm = 1 - sky.night * 0.42, hz = RENDER_TUNE.haze, hor = sky.hor;
  // N64 distance fog: the whole floor blends toward the sky/horizon colour over a near→far band,
  // so the far ground and the wall of horizon buildings dissolve into the same fog the sky fades to
  // (the classic short-draw-distance mask). Colour = horizon × night dim, so it's pale by day and
  // dark by night and the seam at the horizon disappears. Precomputed per frame; the per-texel cost
  // is one clamp + a lerp. FOG_NEAR/FAR are in Mode-7 world-distance (d) units.
  const cwarp = RENDER_TUNE.coastWarp ?? 0.5, cwarpOn = cwarp > 0.001;   // shoreline/biome de-blocking amplitude (tiles); 0 = plain grid coast
  const FOG = RENDER_TUNE.fog || 0;   // FOG_NEAR/FOG_FAR are module-shared with the building pass
  const fogR = hor[0] * nm, fogG = hor[1] * nm, fogB = hor[2] * nm;
  // Per-tile material LUT for the visible window, built once per frame so the per-pixel sampler
  // just indexes it: each entry is [r, g, b, waterness, grassness, hillshade], or null for an
  // unbuilt/off-map tile. The nulls are then resolved by fillOffMap: land edges run on as the arid
  // dirt→redrock wildlands and water edges run on as open sea, split by a noise-wobbled irregular
  // coastline (only a window with no built tile at all falls back to open ocean).
  const OFF = BIOME_GROUND.water;
  const OFF5 = [OFF[0], OFF[1], OFF[2], 1, 0, 1], mh = map ? map.length : 0;
  // Relief lighting: hillshade each tile off the procedural elevation gradient, lit by the
  // sun (a fixed NW key at night). Baked per-tile here (cheap) and bilinear-sampled per pixel.
  const wc = v.mapCenter || { x: 0, y: 0 }, wcx = wc.x, wcy = wc.y;
  const litX = sun && sun.elev > 0.05 ? sun.dir[0] : -0.62, litY = sun && sun.elev > 0.05 ? sun.dir[1] : -0.62;
  let LUT = null, wildFill = null;
  if (map) {
    LUT = new Array(mh);
    wildFill = map.map((row) => new Array(row.length).fill(null));   // parallel grid; fillOffMap tags each empty tile sea|scrub|redrock
    for (let ry = 0; ry < mh; ry++) {
      const row = map[ry], out = new Array(row.length);
      for (let rx = 0; rx < row.length; rx++) {
        const c = row[rx], bi = c && c.biome;
        let grassy = GRASS_BIOMES.has(bi);
        // Grassed district tile touching a runway → keep it grey tarmac apron, not turf.
        const apron = grassy && nearField(map, rx, ry);
        if (apron) grassy = false;
        if (!bi) { out[rx] = null; continue; }   // unbuilt/off-map — fillOffMap inherits it from the nearest built tile
        const awx = (rx - R) + wcx, awy = (ry - R) + wcy;   // absolute world tile (relief stays put, doesn't slide)
        const arid = !apron && ARID_BIOMES.has(bi) ? 1 : 0;
        let col = apron ? APRON_GREY : (BIOME_GROUND[bi] || gTop);
        // Arid tint jitter: drift each dry tile between rust / ochre / pale sand off a per-tile
        // noise value, so a whole redrock district isn't one flat plate but a mottled badland.
        if (arid) { const j = vnoise2(awx * 0.21, awy * 0.21) - 0.5; col = [clamp(col[0] + j * 46, 40, 210), clamp(col[1] + j * 30, 30, 190), clamp(col[2] + j * 22, 24, 170)]; }
        const shade = reliefShade(awx, awy, litX, litY, arid);
        const paved = apron || PAVED_BIOMES.has(bi) ? 1 : 0;   // man-made surface → excluded from the coast wobble
        out[rx] = [col[0], col[1], col[2], bi === 'water' ? 1 : 0, grassy ? 1 : 0, shade, paved];
      }
      LUT[ry] = out;
    }
    LUT = fillOffMap(LUT, mh ? map[0].length : 0, mh, R, wcx, wcy, litX, litY, wildFill, st);   // extend the edge → wildlands + irregular coast
  }
  v._wildFill = wildFill;   // hand the gap classification to drawWorldObjects (same frame, runs after this floor pass)
  const sample = (rx, ry) => {
    if (!LUT) return OFF5;
    const cy = ry < 0 ? 0 : ry >= mh ? mh - 1 : ry;                          // clamp into the window, then read the
    const rw = LUT[cy], cx2 = rx < 0 ? 0 : rx >= rw.length ? rw.length - 1 : rx;   // (now edge-extended) LUT
    return rw[cx2] || OFF5;
  };
  // Tell the later reflection pass whether the craft sits over water, using the SAME edge-extended
  // LUT the blit samples — so the open off-map OCEAN counts as water too (the raw map biome is null
  // out there and doesn't know about the ocean fill, which is why reflections only showed over built
  // harbour tiles). Sampled at the craft's ground point (mapOffset → centre tile).
  // The Echelon's deck sits over water (she floats on the sea), so her helipad tile is classified as
  // water — which would spuriously fire the wash on solid deck. Suppress it when the craft's own tile
  // is her yacht cell: a heli on the pad shouldn't churn the deck.
  const _cc = map ? (map[Math.round(R)] || [])[Math.round(R)] : null;
  const onDeck = !!(_cc && _cc.mark === 'yacht');
  const t = (now || 0) * 0.001;
  // A caller (the Helm chase, which holds position) can pass `seaScroll` — an accumulated
  // along-heading distance — so the swell streams past and reads as MAKING WAY even though the
  // map window isn't translating. Normal flight passes none (0), so it's unaffected.
  const seaScroll = v.seaScroll || 0, ssX = Math.sin((v.heading || 0) * Math.PI / 180) * seaScroll, ssY = -Math.cos((v.heading || 0) * Math.PI / 180) * seaScroll;
  // Rotor downwash: when a HELI (v.cls==='heli', the Dragonfly) is low over water, the rotor beats a
  // disturbed disc into the surface under it — a matted crater ringed with spray and out-running
  // ripples. Strongest in ground effect (low height), gone as it climbs away; zero for fixed-wing, so
  // no per-texel cost on a normal flight. The disc is centred on the craft's ground point (mapOffset).
  // `rotor` ties it to actual rotor RPM (v.propSpin: ~0.2 idle → 1 full, winds to 0 a beat after
  // shutdown) so a parked/cold heli makes NO wash, and the ripple rate below scales with rpm too.
  const isHeli = v.cls === 'heli' || v.heli;
  const rotor = isHeli ? clamp(((v.propSpin || 0) - 0.1) / 0.9, 0, 1) : 0;
  const heliDown = isHeli && !onDeck ? clamp(1 - (v.height || 0) / 0.16, 0, 1) * rotor : 0;
  const dcx = off ? off.x : 0, dcy = off ? off.y : 0;
  for (let by = 0; by < usedH; by++) {
    const p = Math.max(0.004, (yTop + by * DS - horizonY) / depth);
    const d = EH / p;
    // Fresnel reflectivity for water — per-ROW (depends only on the view depression angle, not on
    // x). Steep views (near, looking down INTO the water) show its deep body colour; grazing views
    // (far, toward the horizon) mirror the bright sky. That angle-graded blend is what reads as a
    // real reflective surface rather than flat blue. cosI = cos(angle off the vertical surface
    // normal) = EH/‖(d,EH)‖; Schlick's (1-cosI)^5 curve rises to ~1 at the grazing horizon.
    const cosI = EH / Math.sqrt(d * d + EH * EH);
    const fres = 0.02 + 0.98 * (1 - cosI) ** 5;
    // High-frequency detail (wave shimmer, sun glitter, concrete/grass mottle) aliases into a
    // hard nearest-neighbour checkerboard once a low-res texel spans several world units —
    // worst in the mid/far field where each depth band jumps in world-space. Fade the detail
    // AMPLITUDE out with distance (near = full, far = flat base colour): a cheap mip-map that
    // kills the checker without touching the intended chunky Mode-7 blit.
    const detail = clamp(1.15 - d * 0.7, 0.15, 1);
    const haze = clamp(1 - p * hz, 0, hazeMax), ih = 1 - haze;
    const hr = hor[0] * haze, hg = hor[1] * haze, hb = hor[2] * haze;
    let idx = by * bw * 4;
    for (let bx = 0; bx < bw; bx++) {
      const l = ((X0 + bx * DS - cx) / halfW) * d * LAT;
      const wx = ax + d * sinh + l * cosh, wy = ay - d * cosh + l * sinh;
      // Domain-warp the SAMPLING position so the land/water boundary (and biome patches) meander off
      // the square tile grid — rounds the blocky 90° corners off the coast. CRUCIAL: the sine PHASE
      // reads ABSOLUTE world coords (wx+wcx, wy+wcy), so the wavy pattern is pinned to the world and
      // does NOT snap when the map window recenters as you move (the old bug was phasing it on the
      // window-relative wx/wy, which jumped a whole tile each recenter). The displacement itself is
      // still added to the window-relative wx/wy that index the LUT.
      let wpx = wx, wpy = wy;
      // Keep man-made surfaces (concrete/tarmac/pier/airport/apron) dead straight-edged. The colour is
      // a bilinear blend of the FOUR tiles around the warped position, so it's not enough to check the
      // source + nearest tile — apply the warp only when ALL FOUR tiles the blend will actually sample
      // are natural (plus the source). Otherwise a warped grass texel could still pull a paved tile into
      // its blend footprint and wobble the paved edge. Near paved, texels stay unwarped → tile-straight.
      if (cwarpOn && !sample(Math.floor(R + wx), Math.floor(R + wy))[6]) {
        const awx = wx + wcx, awy = wy + wcy;
        const nx = wx + cwarp * Math.sin(awy * 1.9 + awx * 0.5), ny = wy + cwarp * Math.sin(awx * 1.9 - awy * 0.5 + 2.1);
        const jx = Math.floor(R + nx), jy = Math.floor(R + ny);   // the warped bilinear footprint
        if (!sample(jx, jy)[6] && !sample(jx + 1, jy)[6] && !sample(jx, jy + 1)[6] && !sample(jx + 1, jy + 1)[6]) { wpx = nx; wpy = ny; }
      }
      // Bilinear-blend the terrain across the four nearest tile centres so neighbouring
      // biomes (grass→road, land→water) fade into each other instead of switching hard at
      // the tile seam. waterW/grassW carry the same blend so the material treatment below
      // feathers out over the shoreline too.
      const fx = R + wpx, fy = R + wpy, ix = Math.floor(fx), iy = Math.floor(fy), fxr = fx - ix, fyr = fy - iy;
      const s00 = sample(ix, iy), s10 = sample(ix + 1, iy), s01 = sample(ix, iy + 1), s11 = sample(ix + 1, iy + 1);
      const w00 = (1 - fxr) * (1 - fyr), w10 = fxr * (1 - fyr), w01 = (1 - fxr) * fyr, w11 = fxr * fyr;   // smooth blend — water/grass/relief keep this
      // Biome COLOUR blends only in a narrow band right at the tile seam, so each patch of
      // terrain reads as a crisp tile instead of a long cross-fade. Sharpen the fractional
      // position around the boundary (smoothstep over ±EB) before weighting the colours.
      const EB = 0.1, seam = (u) => { const t = clamp((u - 0.5 + EB) / (2 * EB), 0, 1); return t * t * (3 - 2 * t); };
      const cxr = seam(fxr), cyr = seam(fyr);
      const cw00 = (1 - cxr) * (1 - cyr), cw10 = cxr * (1 - cyr), cw01 = (1 - cxr) * cyr, cw11 = cxr * cyr;
      let br = s00[0] * cw00 + s10[0] * cw10 + s01[0] * cw01 + s11[0] * cw11;
      let bg = s00[1] * cw00 + s10[1] * cw10 + s01[1] * cw01 + s11[1] * cw11;
      let bb = s00[2] * cw00 + s10[2] * cw10 + s01[2] * cw01 + s11[2] * cw11;
      const waterW = s00[3] * w00 + s10[3] * w10 + s01[3] * w01 + s11[3] * w11;
      const grassW = s00[4] * w00 + s10[4] * w10 + s01[4] * w01 + s11[4] * w11;
      const shadeW = s00[5] * w00 + s10[5] * w10 + s01[5] * w01 + s11[5] * w11;
      const dryW = clamp(1 - waterW * 4, 0, 1) * (1 - grassW);   // bare dry land coord (1 = open desert, 0 = water/turf); drives arid material + aerial perspective
      // Base material: a WHISPER of concrete tone variation + within-tile diagonal gradient.
      // Kept very low — a stronger checker read as a distracting tiled pattern on flat grey
      // asphalt/apron (the whole thing pulsing like a chessboard as you flew over it).
      const wxf = wx * FREQ, wyf = wy * FREQ, tx = Math.floor(wxf * 2), ty = Math.floor(wyf * 2);
      const grad = ((wxf - Math.floor(wxf)) + (wyf - Math.floor(wyf))) * 0.03 - 0.03;
      let tex = 1 + ((((tx + ty) & 1) ? 0.022 : -0.022) + (((tx * 5 ^ ty * 3) & 3) === 0 ? 0.018 : 0) + grad) * detail;
      // Grass: a finer mottle so parkland reads as vegetation, not a flat green slab.
      if (grassW > 0.002) {
        const gx = Math.floor(wx * 5.3), gy = Math.floor(wy * 5.3);
        tex = tex * (1 - grassW) + (1 + (((gx * 7 ^ gy * 13) & 3) * 0.05 - 0.075) * detail) * grassW;
      }
      // Relief hillshade — brightens sun-facing slopes, darkens the lee; land only, so the
      // ground reads as gentle rolling hills. Water stays flat (its own wave shading below).
      tex *= shadeW * (1 - waterW) + waterW;
      // Arid ground material: wind-blown sand ripple + broad cracked-clay patches so the dry
      // wildlands read as textured desert, not a flat tinted plate. Gated to near/mid texels
      // (detail) — like the water mottle — so the far plain stays flat and never aliases into a
      // checker; one noise lookup, only on dry ground.
      if (dryW > 0.02 && detail > 0.3) {
        const rip = Math.sin(wx * 2.4 + wy * 0.8) + 0.6 * Math.sin(wx * 0.9 - wy * 1.7);
        const clay = vnoise2(wx * 0.85 + 5, wy * 0.85 - 3) - 0.5;
        tex *= 1 + (rip * 0.025 + clay * 0.11) * dryW * detail;
      }
      // Water + shoreline. waterW rises 0→1 across the shore seam (bilinear), so it doubles
      // as a shoreline coordinate — ~0.5 is the waterline. On top of the blended base colour
      // we layer the cues that make a coast read as a coast instead of a colour crossfade:
      //   · travelling waves + crest glint (open water shimmer)
      //   · depth darkening as you head out from the line into deep water
      //   · an animated surf band hugging the waterline, surging in and out along the coast
      //   · a damp, darker strip of sand just above the line where the wash reaches
      let cr = 0, foam = 0, gln = 0, moon = 0, cap = 0;
      if (waterW > 0.002) {
        // Tier-1 sky sheen: mix the water body colour toward the reflected sky (≈ the horizon
        // colour, which is what a grazing sea reflects) by the fresnel term, scaled by how much of
        // this texel is open water. Deep water underfoot keeps its rich blue; the surface brightens
        // toward the sky as it runs out to the horizon. Waves/glint/foam still layer on top below.
        const sheen = fres * 0.5 * waterW;
        br = br * (1 - sheen) + hor[0] * sheen;
        bg = bg * (1 - sheen) + hor[1] * sheen;
        bb = bb * (1 - sheen) + hor[2] * sheen;
        // A slow, coherent swell (not fast chop): three crossing sine trains at the drifted coords
        // so the sea streams past when making way. Temporal rates are kept low so crests and the
        // specular glitter evolve as a rolling swell rather than a fast, meaningless shimmer.
        const swx = wx + ssX, swy = wy + ssY;
        // De-lattice the swell. Three PURE sines summed on raw world coords make a regular corrugated
        // diamond lattice — the "tiled" read on open water. A per-texel noise domain-warp fixes it but
        // costs 2 noise samples on EVERY water texel, which tanked the frame rate over open sea. Do it
        // with FM instead: phase-modulate each sine train by one shared low-frequency sine (`ph`), with
        // a different push per train so they decorrelate. The crests wander, the grid breaks, and the
        // whole thing costs one extra Math.sin instead of two vnoise2 lookups.
        const ph = Math.sin(swx * 0.6 - swy * 0.45 + t * 0.25);
        const wv = 0.5 * Math.sin(swx * 5.6 + swy * 1.3 + t * 0.9 + ph * 1.6) + 0.4 * Math.sin((swx - swy) * 3.7 - t * 0.66 + ph * 1.1) + 0.11 * Math.sin((swx + swy) * 7.4 + t * 1.25 + ph * 0.7);
        tex = tex * (1 - waterW) + (1 + wv * 0.15 * detail) * waterW;
        const deep = clamp((waterW - 0.5) * 2, 0, 1);
        tex *= 1 - deep * 0.18;   // shallows near the line stay lighter; open water sits darker
        // Deep-water colour mottle: low-frequency non-repeating noise patches the flat blue between the
        // crests into lighter/darker fields (wind lanes) so open water reads as a living surface. It
        // scales with `detail`, so it's invisible on far water anyway — gate the (one) noise lookup to
        // near/mid water so the far field, which fills most of an open-sea frame, pays nothing.
        if (detail > 0.35) {
          const mott = vnoise2(swx * 0.55 + 11, swy * 0.55 - 7) - 0.5;
          tex *= 1 + mott * 0.12 * detail * deep;
        }
        // Scatter the crest highlights. Every sine crest above threshold used to foam, so the whitecaps
        // landed on the swell's regular crest spacing → a grid of bright dots (the "tiled" read). Mask
        // them by a moderate-frequency noise so only SOME crests break — real whitecaps are patchy, not
        // gridded. Sampled ONLY on the rare bright texels (wv high), so it stays cheap.
        const foamMask = wv > 0.75 ? clamp(vnoise2(swx * 1.15 + 20, swy * 1.15 - 6) * 1.7 - 0.4, 0, 1) : 0;
        if (wv > 0.78) cr = (wv - 0.78) * 5 * waterW * foamMask;   // crest glint (scattered, not every crest)
        if (wv > 0.90) cap = (wv - 0.90) * 9 * waterW * foamMask;  // WHITECAP — patchy foam, broken off some crests
        // Sun glitter: a bright, broken specular path across the water TOWARD the sun (fixed by the
        // real bearing, not the drift) — the swell chops it into a shimmering trail of gold flecks.
        if (sun && sun.elev > 0.05) {
          const along = ((wx - ax) * sun.dir[0] + (wy - ay) * sun.dir[1]) / Math.max(0.6, d);
          if (along > 0.12) gln = clamp((along - 0.12) * 1.7, 0, 1) * (0.58 + 0.42 * Math.max(0, wv)) * (0.4 + 0.6 * sun.elev) * waterW;
        }
        // Moonlight: at night the sun is down and open water reads black. Give the swell a cool
        // silver sheen (so the waves are legible) plus a broken specular path toward the moon —
        // the night twin of the sun glitter. Added AFTER the night dimming below so it genuinely
        // lights the dark sea rather than being crushed by it.
        if (sun && sun.moonElev > 0.05 && sun.night > 0.3) {
          let path = 0;
          const along = ((wx - ax) * sun.moonDir[0] + (wy - ay) * sun.moonDir[1]) / Math.max(0.6, d);
          if (along > 0.1) path = clamp((along - 0.1) * 1.4, 0, 1) * (0.4 + 0.6 * Math.max(0, wv));
          moon = sun.night * sun.moonElev * waterW * (0.12 + 0.24 * Math.max(0, wv) + 0.95 * path);
        }
        // Surf: a bright band centred just on the water side of the waterline, pulsing with
        // the swell and breaking unevenly along the coast (time + position phase).
        const band = clamp(1 - Math.abs(waterW - 0.56) / 0.16, 0, 1);
        if (band > 0) foam = band * band * (0.55 + 0.45 * Math.sin(t * 1.6 + (wx + wy) * 2.7 + wv * 1.5));
      }
      // Wet sand: the land strip just above the waterline reads damp where the wash reaches.
      if (waterW > 0.14 && waterW < 0.5) tex *= 1 - clamp(1 - Math.abs(waterW - 0.32) / 0.18, 0, 1) * 0.14;
      // Raised shore bank: with no vertical displacement on this flat floor the coast lies flush
      // with the sea and reads as a pancake. Emboss the seam instead — a bright sunlit LIP on the
      // top of the land edge (just above the waterline) sitting over a thin contact SHADOW in the
      // shallows at its foot. The lip-over-shadow pair reads as a low bank standing UP out of the
      // water and casting a shadow onto it, so the land no longer sits razor-flat against the sea.
      if (waterW > 0.38 && waterW < 0.5) tex *= 1 + clamp(1 - Math.abs(waterW - 0.44) / 0.06, 0, 1) * 0.11;   // sunlit bank lip (land side)
      if (waterW >= 0.5 && waterW < 0.60) tex *= 1 - clamp(1 - Math.abs(waterW - 0.53) / 0.05, 0, 1) * 0.17;   // bank-foot contact shadow (water side, just inside the surf)
      // Near-camera detail. Forward resolution collapses as d→EH (the classic Mode-7 near
      // smear): the closest rows sample a razor-thin world slice, so the base wave/texture —
      // tuned for the mid-field — barely varies across them and the foreground flattens into
      // one dark colour that reads as a hole in the floor. Fold in a finer, higher-frequency
      // animated ripple (water) or gravel grain (land) whose strength rises as the ground
      // nears, carrying real world-space texture right down to the bottom edge — so the
      // foreground stays surfaced without lifting the camera or drawing more cowl.
      const near = clamp((0.55 - d) / 0.55, 0, 1);
      if (near > 0.01) {
        if (waterW > 0.002) {
          // De-lattice the fine ripple too, same pure-sine grid as the swell — FM again (one sine),
          // not a noise warp, to keep the near-field cheap. It's the most visible tiling when hovering
          // low (the heli), so it's worth breaking, but not worth 2 noise lookups per near texel.
          const nwx = wx + ssX, nwy = wy + ssY;
          const nph = Math.sin(nwx * 2.3 - nwy * 1.7 + t * 0.4);
          const wv2 = 0.5 * Math.sin(nwx * 22 + nwy * 15 - t * 1.3 + nph * 0.9) + 0.5 * Math.sin((nwx + nwy) * 17 + t * 1.0 + nph * 0.7);
          tex *= 1 + (0.06 + wv2 * 0.11) * near * waterW;               // lift + fine chop breaks the flat dark
          if (wv2 > 0.7) cr = Math.max(cr, (wv2 - 0.7) * 2.6 * near * waterW);   // fine crest lift (neutral, day or night)
          if (wv2 > 0.86) cap = Math.max(cap, (wv2 - 0.86) * 6 * near * waterW); // near-field whitecaps
        } else {
          const nx = Math.floor(wx * 14.7), ny = Math.floor(wy * 14.7);
          tex *= 1 + (((nx * 7 ^ ny * 13) & 3) * 0.045 - 0.065) * near;  // fine dirt/gravel grain
        }
      }
      // Rotor downwash disc — heli, low, over water. A dark matted crater directly under the disc,
      // a bright annulus of spray at its rim, and concentric ripples running outward across it.
      if (heliDown > 0.002 && waterW > 0.002) {
        const rdx = wx - dcx, rdy = wy - dcy, rr = Math.sqrt(rdx * rdx + rdy * rdy);
        if (rr < 1.8) {                                              // tight disc — the Mini 500 is a tiny kit heli, not a Chinook
          const dwv = heliDown * clamp(1 - rr / 1.8, 0, 1) * waterW;
          const ring = Math.sin(rr * 9 - t * (3 + 7 * rotor));       // rings expand outward at a rate that scales with rotor RPM
          const core = Math.exp(-rr * rr / 0.25);                    // matted crater, peak dead-centre
          const rim = Math.exp(-((rr - 0.55) * (rr - 0.55)) / 0.18); // spray concentrated at the (closer-in) disc rim
          tex *= 1 + (ring * 0.09 - core * 0.1) * dwv * detail;       // out-running ripples over a pressed-down crater
          foam = Math.max(foam, rim * 0.9 * dwv);                     // spray-ring foam (gets the *=detail below)
          cap = Math.max(cap, rim * (0.3 + 0.4 * Math.max(0, ring)) * dwv);   // bright spray flecks breaking off the ring
        }
      }
      cr *= detail; foam *= detail; gln *= detail; moon *= detail; cap *= detail;   // fade the bright specular spikes out with distance too (near ≈ full)
      // Moonlight is added OUTSIDE the night multiplier (nm) — it IS the night's light, so it must
      // survive the dimming that turns the daytime sea dark. Cool silver-blue (R<G<B).
      const mAdd = moon * ih;
      // Whitecaps: bright neutral foam on breaking crests — full by day, dimmer but still catching
      // moonlight at night (so the sea reads alive in both).
      const capAdd = cap * 205 * ih * (0.45 + 0.55 * nm);
      let or_ = ((br * tex + cr * 55 + foam * 150 + gln * 150) * ih + hr) * nm + mAdd * 120 + capAdd;
      let og = ((bg * tex + cr * 70 + foam * 165 + gln * 132) * ih + hg) * nm + mAdd * 140 + capAdd;
      let ob = ((bb * tex + cr * 90 + foam * 175 + gln * 66) * ih + hb) * nm + mAdd * 185 + capAdd * 1.06;
      // Aerial perspective for the arid wildlands. Clear-weather haze is deliberately light, so the
      // dry dirt/redrock plain would otherwise keep near-full saturation right up to a high horizon
      // and read as a looming wall / mountains. Fade DISTANT dry ground toward the horizon colour so
      // the infinite plain recedes flat. Water (its own wave/glint) and parkland/city (grassW) are
      // left alone — only bare dry land washes out.
      const dry = dryW;
      if (dry > 0.02) {
        const lh = dry * clamp((d - 10) / 44, 0, 1) * 0.6;   // 0 within ~10 tiles → up to 0.6 at the horizon
        const inv = 1 - lh;
        or_ = or_ * inv + hor[0] * nm * lh; og = og * inv + hor[1] * nm * lh; ob = ob * inv + hor[2] * nm * lh;
      }
      // N64 distance fog — applied last, uniformly to all terrain (water/grass/city alike), so the
      // far field recedes into the sky. Squared ramp = crisp foreground, fog thickening into the far.
      if (FOG > 0.001) {
        const ff = clamp((d - FOG_NEAR) / (FOG_FAR - FOG_NEAR), 0, 1);
        const w = ff * ff * FOG, iw = 1 - w;
        or_ = or_ * iw + fogR * w; og = og * iw + fogG * w; ob = ob * iw + fogB * w;
      }
      data[idx] = or_; data[idx + 1] = og; data[idx + 2] = ob;
      data[idx + 3] = 255;
      idx += 4;
    }
  }
  buf.cx.putImageData(buf.img, 0, 0, 0, 0, bw, usedH);
  const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buf.c, 0, 0, bw, usedH, X0, yTop, spanX, usedH * DS);
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

// ── Fly-through volumetric cloud deck ───────────────────────────────────────────
// The dome billboards above sit on the sky sphere at infinity — you can never reach them. This
// layer instead hangs real puffs in the WORLD, scattered inside the SAME drifting weather-field
// cells that drive the rain and the lightning (st.cells), at a fixed altitude band (RENDER_TUNE
// .cloudZ), and projects them through the SAME Mode-7 camera as the ground — so a front you can
// see on the horizon is one you fly INTO: the puffs grow on approach, parallax past the wings,
// split left/right/over/under, and — when the eye crosses into the cell at cloud height — bloom
// into a whiteout that clears on the far side. Each puff is a small STACK of cards (a horizontal
// spread + a lit crown and a shaded base) at their own world offsets, projected independently: only
// their screen POSITION comes from the projection, so they don't rotate rigidly with the view the
// way one flat billboard would — the stack reads as a puff with real thickness. Field-only: no
// field (or none nearby) ⇒ no fly-through clouds, and the far dome billboards keep the horizon. A
// camera-locked haze band (thickening inside a front) underlays it. Returns the eased 0..1 immersion.
// Card template: [ox, oy, oz] world offsets as fractions of the puff radius, then [sizeMul, litBias].
// A fat core, four around it (the horizontal spread), a lit crown up in z and a shaded base below.
// Realistic cloud-base ALTITUDE (ft) per condition. The server gives us no ceiling, so we pick a
// believable base for the weather: ground fog hugs the deck; overcast, rain and snow ride a low-mid
// stratus deck; fair-weather cumulus sit higher; storms tower off a mid base. Converted to the SAME
// Mode-7 world-z the camera climbs through (matching makeCam's EH curve, EH = eh + climbLift·√(alt/3000)),
// so the deck sits at that real altitude — overhead when you're on the runway, flown INTO only once you
// actually climb up to it, never smeared across the ground the way the old fixed low base was.
const CLOUD_BASE_FT = { clear: 3200, cloudy: 1600, rain: 1200, storm: 1800, snow: 1500, fog: 150, ash: 900, dust: 700 };
const cloudBaseZ = (wx) => Math.max(0.05, RENDER_TUNE.eh + Math.sqrt((CLOUD_BASE_FT[wx] ?? 1600) / 3000) * RENDER_TUNE.climbLift);
// Card template: [ox, oy, oz, sizeMul, litBias, yScale] as fractions of the puff radius. A real
// cumulus is NOT a symmetric ball of smoke — it has a FLAT, SHADOWED base sitting on the ceiling and
// BILLOWS UPWARD into rounded, sunlit cauliflower lobes. So the base cards sit low (oz≈0), wide and
// heavily SQUASHED (yScale→0.4) and DARK (litBias→0.1); the body lobes rise (oz+) and brighten; the
// crowns are small, near-round (yScale→0.9) and brightest (litBias→1). Ordered base→body→crown so a
// phone's 4-card prefix still spans the whole vertical form instead of only the base slab.
const CLOUD_CARDS = [
  [ 0.00,  0.00,  0.05, 1.22, 0.10, 0.40],   // 0 flat wide shadowed base slab
  [-0.04,  0.06,  0.50, 0.88, 0.52, 0.76],   // 1 mid body billow
  [ 0.03, -0.02,  0.90, 0.46, 1.00, 0.94],   // 2 bright crown
  [-0.62,  0.22,  0.08, 0.80, 0.16, 0.44],   // 3 base lobe (L)
  [ 0.64, -0.14,  0.10, 0.80, 0.17, 0.44],   // 4 base lobe (R)
  [ 0.34,  0.18,  0.48, 0.74, 0.56, 0.76],   // 5 mid lobe
  [-0.34, -0.10,  0.46, 0.72, 0.48, 0.76],   // 6 mid lobe
  [ 0.18, -0.05,  0.82, 0.42, 0.95, 0.92],   // 7 crown lobe
  [-0.15,  0.10,  0.78, 0.42, 0.90, 0.92],   // 8 crown lobe
];
// How CUMULIFORM the weather is: 1 = heaped, towering cauliflower (fair-weather cumulus, storm cells);
// 0 = a flat, featureless STRATUS sheet (overcast, fog, snow). Drives vertical billow, how wide the
// puffs spread into a sheet, and how much top-to-bottom light contrast they carry.
const CLOUD_CUMULUS = { clear: 1.0, cloudy: 0.35, rain: 0.45, storm: 1.0, snow: 0.3, fog: 0.12, ash: 0.55, dust: 0.45 };
// A memoised value-noise tile, stamped over the larger cloud cards in 'overlay' blend so the
// billows gain a mottled, curdled surface (light + dark patches at a few scales) instead of reading
// as a smooth airbrushed gradient — the single biggest "that's vapour, not smoke" texture cue.
let _cloudNoiseTex = null;
function cloudNoiseTex(){
  if (_cloudNoiseTex) return _cloudNoiseTex;
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(128,128,128)'; g.fillRect(0, 0, S, S);   // neutral grey → overlay no-op where untouched
  for (let scale = 0; scale < 3; scale++) {
    const n = 10 + scale * 14, r = 15 - scale * 4;
    for (let i = 0; i < n; i++) {
      const x = frac(i * 3.1 + scale * 7.7) * S, y = frac(i * 5.7 + scale * 2.3) * S;
      const val = 128 + (frac(i * 8.3 + scale * 1.9) * 2 - 1) * (30 - scale * 7) | 0;   // lighter/darker blotch
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `rgba(${val},${val},${val},0.55)`); rg.addColorStop(1, 'rgba(128,128,128,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  }
  _cloudNoiseTex = c; return c;
}
// Baked puff sprite. The swarm is hundreds of cards per frame, but base/lit tints are CONSTANT across
// a frame and only a handful of distinct lit-values exist — so we bake each tint ONCE to an offscreen
// radial-gradient disc and BLIT it per card instead of building a fresh gradient + ellipse fill every
// card. drawImage of a cached sprite is far cheaper than a per-card gradient; the bake cost (≤12
// gradients/frame, memoised per tint signature) is negligible against the card count it replaces.
// Baked round + symmetric; the per-card vertical squash (ys) comes from the drawImage dest height,
// and the highlight is biased slightly UP for a fixed "lit from above" form.
const PUFF_PX = 48, PUFF_BUCKETS = 6, PUFF_BLIT_MAX = 26;   // cards wider than PUFF_BLIT_MAX px keep the full per-card gradient (the few near "hero" puffs); the rest blit
function bakePuffSprite(col, shade) {
  const S = PUFF_PX, c = texCanvas(S * 2, S * 2), g = c.getContext('2d');
  const rg = g.createRadialGradient(S, S - S * 0.12, S * 0.14, S, S, S);
  rg.addColorStop(0, rgb(col, 1)); rg.addColorStop(0.5, rgb(col, 0.95));
  rg.addColorStop(0.82, rgb(shade, 0.5)); rg.addColorStop(1, rgb(shade, 0));
  g.fillStyle = rg; g.beginPath(); g.ellipse(S, S, S, S, 0, 0, 7); g.fill();
  return c;
}
function drawVolumetricClouds(ctx, cam, st, v, base, lit, alpha, storm, night, dt, W, H, horizonY, wx, lightX, lightY, lightStr) {
  const cells = st.cells, ax = v.acX, ay = v.acY;
  if (!cells || !cells.length || ax == null || ay == null) return st.cloudImm = 0;
  // Many small puffs, few cards each: the deck is built from a DENSE swarm of small puffs (≈10× the
  // old count, each a fraction of the size) rather than a sparse handful of big cauliflower stacks —
  // finer, more detailed vapour. Each small puff needs only a short card stack (base/body/crown +
  // a couple of lobes), so the total card budget stays sane despite the 10× puff count.
  const nCards = W < 720 ? 3 : 5;                    // shorter stacks — the density comes from puff COUNT now
  const puffMul = W < 720 ? 7 : 15, puffCap = W < 720 ? 50 : 140, puffMin = W < 720 ? 18 : 36;
  const RANGE = 48, baseZ = cloudBaseZ(wx), thick = RENDER_TUNE.cloudThick;   // base sits at a realistic altitude for the weather (see CLOUD_BASE_FT)
  // Cumuliform vs stratiform shaping: cumulus billow tall and heaped (vScale up, hScale tight); a
  // stratus sheet is flat and spread wide (vScale down, hScale up). `litComp` also flattens the
  // top/bottom light contrast toward a uniform grey for stratus so it reads as an overcast sheet.
  const cumF = CLOUD_CUMULUS[wx] ?? 0.5;
  const vScale = 0.34 + 0.5 * cumF, hScale = 1 + (1 - cumF) * 0.55, litComp = 0.4 + 0.6 * cumF;
  // Camera-locked haze band around the horizon — a screen-space fog that DOESN'T parallax, layered
  // under the puffs for depth (the "haze that follows the screen"). Thickens inside a front, fades at night.
  const wxCover = sampleWeatherCells(cells, ax, ay).cloud;
  const hazeStr = clamp(wxCover * 0.34 * (1 - night * 0.6), 0, 0.36);
  if (hazeStr > 0.01) {
    const hcol = mix(base, lit, 0.4), g = ctx.createLinearGradient(0, horizonY - H * 0.28, 0, horizonY + H * 0.28);
    g.addColorStop(0, rgb(hcol, 0)); g.addColorStop(0.5, rgb(hcol, hazeStr)); g.addColorStop(1, rgb(hcol, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // Immersion (how deep the eye sits inside the front) drives the whiteout AND how much puff detail is
  // worth drawing — computed BEFORE the swarm is built so a deep whiteout can skip the ENTIRE build.
  // At peak immersion the flood below covers ~95% of the deck, so projecting + gradient-filling
  // hundreds of puffs under it was pure waste (worst exactly when the deck is heaviest and fps lowest).
  // Eased off the previous frame's value so it blooms, not pops; wxCover + vert are both known here.
  const vert = clamp(1 - Math.abs(cam.EH - baseZ) / (thick * 0.9 + 0.5), 0, 1);
  const immTarget = clamp(wxCover, 0, 1) * vert;
  st.cloudImm = (st.cloudImm || 0) + (immTarget - (st.cloudImm || 0)) * clamp(dt * 3.2, 0, 1);
  const imm = st.cloudImm, cardScale = clamp(1 - imm * 1.18, 0, 1);   // cards fade fully OUT before the whiteout peaks (was ·0.85 → never reached 0); ≤0 ⇒ skip the swarm entirely
  // Scatter a clump of puffs inside each nearby cell (deterministic in the cell's seed, so the clump
  // rides along as the front drifts) and build the card stacks. Mirrors the dome field-cell scatter.
  // Cells are worked NEAREST-FIRST against a global puff budget: "lots of clouds" = lots of active
  // cells, and without a ceiling the card count (and its per-card radial-gradient fills) grows
  // unbounded → framerate collapse. The budget caps total work; far cells thin out first (they hide
  // behind nearer puffs and the whiteout anyway), and the fps dial (cloudQ) scales the ceiling.
  const q = st.cloudQ ?? 1;
  const mottleOK = q > 0.7;                                 // shed the clip+drawImage noise overlay under load
  // cardScale ≤ 0 ⇒ the whiteout fully covers the deck: zero the budget so the whole swarm build is
  // skipped (not merely its draw) — the real saving is NOT projecting/filling puffs you can't see.
  let budget = cardScale > 0.02 ? Math.round((W < 720 ? 150 : 340) * q) : 0;   // total puffs this frame across all cells
  const budget0 = Math.max(1, budget);                      // starting budget → soft-fade the last slice of it (below)
  const nearCells = [];
  for (const c of cells) {
    if (c.intensity <= 0.02) continue;
    const d = Math.hypot(c.x - ax, c.y - ay);
    if (d > RANGE + 8) continue;
    nearCells.push({ c, d });
  }
  nearCells.sort((a, b) => a.d - b.d);
  // Frustum cull: only puffs inside the forward view cone are worth projecting. cam.sinh/cosh split
  // a world offset into forward (fwd) + lateral (lat); |lat| under fwd·halfExt means it lands within
  // the screen's horizontal span. Rejecting everything behind and beside the camera BEFORE the costly
  // projection + gradient cards means the global budget is spent only on puffs you can SEE — so the
  // in-view deck is several times denser (and can afford smaller, finer puffs) for the same draw cost.
  const halfExt = (W / 2) / cam.FL, camBack = cam.back || 0;
  const cards = [];
  for (const { c } of nearCells) {
    if (budget <= 0) break;
    const stormy = c.type === 'storm' || c.type === 'precip';
    const sprites = Math.min(puffCap, Math.max(puffMin, Math.round(c.r * puffMul)));
    for (let k = 0; k < sprites; k++) {
      if (budget <= 0) break;
      const rr = Math.sqrt(frac(c.seed + k * 1.7)) * c.r * 0.95, th = frac(c.seed + k * 3.3) * 6.2832;
      const dx = c.x + Math.cos(th) * rr - ax, dy = c.y + Math.sin(th) * rr - ay, dist = Math.hypot(dx, dy);
      if (dist > RANGE) continue;
      const fwd = dx * cam.sinh - dy * cam.cosh + camBack;
      if (fwd <= 0.12) continue;                                  // behind the eye
      const lat = dx * cam.cosh + dy * cam.sinh;
      if (Math.abs(lat) > fwd * halfExt + 3.0) continue;          // outside the forward cone (+ puff-radius margin)
      budget--;                                                   // survived the cull → this puff draws; charge the budget
      // Soft budget edge: puffs are drawn nearest-cell-first, so the LAST slice of the budget is
      // always the farthest in-view puffs — the ones tucked behind nearer puffs, haze and the
      // whiteout. Fade that tail out (last ~18% of the budget) instead of hard-popping it when the
      // cap is hit, so the deck's far edge dissolves smoothly as the cap breathes rather than blinking.
      const budgetFade = clamp(budget / (budget0 * 0.18), 0, 1);
      // Anchor the puff BASE near the ceiling, but scatter over a TALLER band now (the deck is thicker)
      // and let the cards billow UP from there, so the deck has depth instead of a thin flat sheet.
      const pz = baseZ + frac(c.seed + k * 2.9) * thick * 0.55;
      // Small puffs — the detail lives in their number, not their size. With the view-cone cull the
      // budget now buys only visible puffs, so we can afford finer (smaller) ones and still fill the sky.
      const R = (1.1 + frac(c.seed + k * 5.7) * 1.25) * (0.7 + clamp(c.intensity, 0, 1) * 0.5);
      const distFade = clamp(1 - dist / RANGE, 0.04, 1), cellA = alpha * clamp(c.intensity, 0.5, 1) * budgetFade;
      // Inter-lobe ambient occlusion: a soft dark pool sunk into the puff base, sorted FARTHEST
      // (f+3) so it paints first, UNDER the lobes — deepening the shadowed crevices where the
      // cauliflower heaps meet, instead of every lobe reading equally bright.
      const pbase = cam.proj(dx, dy, pz);
      if (pbase.f > 0.12 && distFade > 0.4) {   // AO only on near puffs — the dense swarm makes a per-puff pool everywhere too costly
        const sAO = clamp(R * 0.95 * cam.FL / pbase.f, 2, W * 0.9);
        cards.push({ ao: true, x: pbase.sx, y: pbase.sy + sAO * 0.16, s: sAO, f: pbase.f + 3, a: cellA * distFade * 0.4 });
      }
      for (let ci = 0; ci < nCards; ci++) {
        const cd = CLOUD_CARDS[ci];
        const jx = (frac(c.seed + k * 3.1 + ci * 2.1) - 0.5) * 0.5, jy = (frac(c.seed + k * 1.7 + ci * 4.3) - 0.5) * 0.5;
        const p = cam.proj(dx + (cd[0] + jx) * R * hScale, dy + (cd[1] + jy) * R * hScale, pz + cd[2] * R * vScale);
        if (p.f <= 0.12) continue;                     // card is at/behind the eye → the whiteout covers it
        const near = smoothstep((p.f - 0.3) / 0.9);    // dissolve cards as they reach the eye so they melt INTO the whiteout, not balloon
        const sPx = clamp(R * cd[3] * 0.62 * cam.FL / p.f, 2, W * 0.9);
        const litEff = 0.5 + (cd[4] - 0.5) * litComp;   // full bright-top/dark-base range for cumulus; compressed toward flat grey for stratus
        cards.push({ x: p.sx, y: p.sy, s: sPx, f: p.f, a: cellA * distFade * near, lit: litEff, oz: cd[2], ys: cd[5], stormy });
      }
    }
  }
  // (immersion + cardScale computed above, before the swarm build — inside a front you see uniform
  // fog, not lumps, so the deck fades toward the whiteout and the build is skipped once it's covered.)
  if (cardScale > 0.02) {
    cards.sort((a, b) => b.f - a.f);                   // far first (painter's)
    const noiseTex = cloudNoiseTex();
    const litOK = lightStr > 0.05 && lightX != null;
    // Per-frame baked-sprite cache. base/lit are constant across the frame, so bake each lit-bucket
    // (× normal/stormy) ONCE and reuse it for every small card. Invalidated when the frame's tint
    // signature changes (time of day / weather). puffSet lazily bakes a bucket array on first use.
    const psig = `${base[0] | 0},${base[1] | 0},${base[2] | 0}|${lit[0] | 0},${lit[1] | 0},${lit[2] | 0}`;
    if (st.puffSig !== psig) { st.puffSig = psig; st.puffSprites = {}; }
    const puffSet = (stormy) => {
      const key = stormy ? 's' : 'n';
      if (st.puffSprites[key]) return st.puffSprites[key];
      const bt = stormy ? mix(base, [78, 84, 94], 0.5) : base, lt = stormy ? mix(lit, [140, 146, 156], 0.5) : lit;
      const arr = [];
      for (let b = 0; b < PUFF_BUCKETS; b++) { const col = mix(bt, lt, b / (PUFF_BUCKETS - 1)); arr.push(bakePuffSprite(col, mix(col, bt, 0.5))); }
      return (st.puffSprites[key] = arr);
    };
    for (const c of cards) {
      if (c.ao) {                                      // ambient-occlusion pool under the lobes
        const rg = ctx.createRadialGradient(c.x, c.y, c.s * 0.1, c.x, c.y, c.s);
        rg.addColorStop(0, rgb([18, 24, 32], c.a * cardScale)); rg.addColorStop(1, 'rgba(18,24,32,0)');
        ctx.fillStyle = rg; ctx.beginPath(); ctx.ellipse(c.x, c.y, c.s, c.s * 0.5, 0, 0, 7); ctx.fill();
        continue;
      }
      // Small cards (the bulk of the swarm) BLIT a baked sprite — no per-card gradient build. Nearest
      // lit bucket; the drawImage dest height applies the per-card squash (ys). The few large "hero"
      // cards (> PUFF_BLIT_MAX px) fall through to the full gradient path for directional light + mottle.
      if (c.s <= PUFF_BLIT_MAX) {
        const spr = puffSet(c.stormy)[Math.round(clamp(c.lit, 0, 1) * (PUFF_BUCKETS - 1))];
        ctx.globalAlpha = clamp(c.a * cardScale, 0, 1);
        ctx.drawImage(spr, c.x - c.s, c.y - c.s * c.ys, c.s * 2, c.s * 2 * c.ys);
        ctx.globalAlpha = 1;
        continue;
      }
      const bt = c.stormy ? mix(base, [78, 84, 94], 0.5) : base, lt = c.stormy ? mix(lit, [140, 146, 156], 0.5) : lit;
      const col = mix(bt, lt, c.lit), a = c.a * cardScale;
      // Directional shading: bias the bright core of the puff TOWARD the key light and pull the lit
      // side's colour toward the light, so sunlight rakes ACROSS each puff and the far side falls into
      // its own soft shadow — a real volumetric light gradient, replacing the old hard silver-rim
      // crescent. Purely the gradient's focus + colour; no extra draw pass.
      let fx = 0, fy = -c.s * 0.12;
      if (litOK) { let lx = lightX - c.x, ly = lightY - c.y; const L = Math.hypot(lx, ly) || 1; fx = lx / L * c.s * 0.44; fy = ly / L * c.s * 0.44 - c.s * 0.05; }
      const litCol = litOK ? mix(col, lt, 0.4 * lightStr) : col;   // near-light side warms toward the lit tint
      const shadeCol = mix(col, bt, 0.5);                          // outer/far edge falls into form shadow
      // A DENSER radial falloff holds opacity through the core, then rolls off to a firmer edge — a
      // solid cloud mass instead of a wispy smoke ring — and the per-card vertical squash (ys) keeps
      // the base shelves flat and the crowns rounded so the stack silhouettes as billowed cauliflower.
      const rg = ctx.createRadialGradient(c.x + fx, c.y + fy, c.s * 0.14, c.x, c.y, c.s);
      rg.addColorStop(0, rgb(litCol, a)); rg.addColorStop(0.5, rgb(col, a * 0.95));
      rg.addColorStop(0.82, rgb(shadeCol, a * 0.5)); rg.addColorStop(1, rgb(shadeCol, 0));
      ctx.fillStyle = rg; ctx.beginPath(); ctx.ellipse(c.x, c.y, c.s, c.s * c.ys, 0, 0, 7); ctx.fill();
      // Value-noise mottle: stamp the curdled tile over big cards (overlay modulates brightness only).
      // Dropped under fps load — the clip+drawImage roughly doubles a card's cost and reads faintest.
      if (mottleOK && c.s > 15 && a > 0.12) {
        ctx.save();
        ctx.beginPath(); ctx.ellipse(c.x, c.y, c.s * 0.98, c.s * c.ys * 0.98, 0, 0, 7); ctx.clip();
        ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = clamp(a * 0.6, 0, 0.5);
        ctx.drawImage(noiseTex, c.x - c.s, c.y - c.s * c.ys, c.s * 2, c.s * c.ys * 2);
        ctx.restore();
      }
    }
  }
  // Virga / rain shafts: faint raked streaks hanging from the base of precip + storm cells toward the
  // ground, fading out before they reach it — a shower reads as a trailing veil, not just a grey lump.
  if (imm < 0.6) for (const c of cells) {
    if (c.intensity <= 0.05 || !(c.type === 'storm' || c.type === 'precip')) continue;
    const cdx = c.x - ax, cdy = c.y - ay, cdist = Math.hypot(cdx, cdy);
    if (cdist > RANGE) continue;
    if (cdx * cam.sinh - cdy * cam.cosh + camBack <= 0.1) continue;   // storm cell behind the camera → its shafts can't be seen
    const shafts = Math.min(8, Math.max(3, Math.round(c.r))), rake = (v.wind || 0) * 0.02;
    const dfade = clamp(1 - cdist / RANGE, 0.04, 1) * (1 - imm), topZ = baseZ - 0.05;
    const col = c.type === 'storm' ? [120, 132, 150] : [150, 162, 176];
    for (let k = 0; k < shafts; k++) {
      const rr = Math.sqrt(frac(c.seed + k * 4.3 + 1.1)) * c.r * 0.8, th = frac(c.seed + k * 2.7 + 0.4) * 6.2832;
      const sx = cdx + Math.cos(th) * rr, sy = cdy + Math.sin(th) * rr;
      const pt = cam.proj(sx, sy, topZ), pb = cam.proj(sx + rake, sy + rake, Math.max(0.15, topZ - thick - 2.2));
      if (pt.f <= 0.12 || pb.f <= 0.12) continue;
      const g = ctx.createLinearGradient(pt.sx, pt.sy, pb.sx, pb.sy);
      const sa = clamp(c.intensity, 0.3, 1) * dfade * (1 - night * 0.4) * (c.type === 'storm' ? 0.32 : 0.22);
      g.addColorStop(0, rgb(col, sa)); g.addColorStop(0.7, rgb(col, sa * 0.35)); g.addColorStop(1, rgb(col, 0));
      ctx.strokeStyle = g; ctx.lineWidth = clamp(c.r * 0.5 * cam.FL / pt.f * 0.02, 1, 5);
      ctx.beginPath(); ctx.moveTo(pt.sx, pt.sy); ctx.lineTo(pb.sx, pb.sy); ctx.stroke();
    }
  }
  // Whiteout: eye inside cloud → flood the view with the lit fog tint (a hair of world still bleeds
  // through at the peak so it reads as dense fog, not a blank frame; storm cells stay grey, not white).
  if (imm > 0.01) {
    ctx.fillStyle = rgb(mix(lit, [255, 255, 255], storm > 0.2 ? 0 : 0.16), imm * (storm > 0.2 ? 0.9 : 0.94));
    ctx.fillRect(0, 0, W, H);
  }
  return imm;
}

// A soft, hazy band of distant rolling land at the horizon, parallax-scrolled by
// heading — the Pilotwings far-terrain read (not hard mountains).
function drawSkyline(ctx, W, H, horizonY, v, sky) {
  const OX = W, shift = ((v.heading || 0) / 360) * W * 2.5;
  const land = mix(sky.hor, sky.g2 || [40, 50, 40], 0.5);
  const stepx = 8;   // fixed px step — fine enough to resolve the ridge lattices so it slides smoothly instead of aliasing as it scrolls
  // Two RECEDING ridge bands instead of one flat bump line, so the far horizon reads as a
  // landmass with depth rather than a single seam against the sea. The FAR ridge sits low,
  // pale (hazed toward the horizon colour) and slow-varying; the NEAR ridge rides on top of it,
  // taller, darker and rougher (a second higher-frequency octave). Parallax: the near ridge
  // pans a touch faster with heading than the far one, so they slide against each other as she
  // comes about. Painted far→near so the near ridge overlaps the far one.
  const layer = (amp, base, tint, alpha, par, oct) => {
    ctx.fillStyle = rgb(mix(land, [255, 255, 255], tint), alpha);
    ctx.beginPath(); ctx.moveTo(-OX, horizonY + 1);
    for (let x = -OX; x <= 2 * W; x += stepx) {
      const p = (x + shift * par);
      let s = vnoise(p * 0.008) * 0.7 + vnoise(p * 0.021) * 0.3;
      if (oct) s = s * 0.68 + vnoise(p * 0.033) * 0.32;   // gentle extra roughness on the near ridge (no ultra-fine octave — its 9px teeth can't be sampled without re-aliasing)
      ctx.lineTo(x, horizonY - (base + s * amp));
    }
    ctx.lineTo(2 * W, horizonY + 1); ctx.closePath(); ctx.fill();
  };
  layer(11, 2, 0.16, 0.30, 0.82, false);   // FAR ridge — low, pale, hazed, slower parallax
  layer(22, 3, 0.04, 0.46, 1.10, true);    // NEAR ridge — taller, darker, rougher, faster parallax
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
  // Embassy Hotel & Bar — warm ochre guest tower.
  ty_embassy: [88, 66, 54],
  // Coldwater Clone Facility — clinical off-white shell + dark glowing vat glass.
  ty_clone: [176, 200, 204], ty_clone_vat: [30, 52, 58],
  // Statue/KSAB media-civic quarter (mid-basin, moderately high-tech: working holo, scuffed).
  ty_ksab: [70, 56, 96], ty_ksab_glass: [86, 78, 116], ty_greenroom: [40, 54, 46], ty_sentinel: [56, 58, 70], ty_jitter: [58, 54, 48],
  ty_ward: [66, 68, 62],
  // Marrow Street downtown strip — cheap civic materials: painted block, oiled iron,
  // green bathhouse tile, soot-warmed brick, canvas-grey, and a corner shop's old paint.
  ty_adequate: [78, 66, 52], ty_bolt: [58, 56, 50], ty_soak: [46, 66, 64],
  ty_broth: [72, 52, 42], ty_secondskin: [62, 60, 54], ty_kessel: [70, 62, 50],
  // Ration Nine — a state ration depot: cold concrete, roller shutter, no charm intended.
  ty_ration: [84, 84, 78],
  // Bespoke named-building shells — a distinct wall tone per silhouette below.
  ty_lux: [58, 52, 78], ty_chrome: [118, 126, 136], ty_meridian: [112, 102, 82], ty_meridian_bronze: [96, 68, 40],
  // Halcyon Towers — dark smoked-teal curtain glass for the futuristic twisting spire.
  ty_halcyon: [26, 42, 62],
  // Solenne Residences — warm champagne/bronze curtain glass for the opulent tapered spire.
  ty_solenne: [60, 50, 34],
  // Airport hangar — ribbed steel siding (renders as corrugated metal, not windows; see METAL_WALL).
  ty_hangarmetal: [120, 128, 138],
  ty_grocery: [78, 100, 66], ty_tech: [46, 88, 96], ty_showroom: [56, 90, 86],
  ty_boutique: [92, 60, 88], ty_junk: [94, 70, 48],
  // Swanky Halcyon-Boulevard nightlife — Voltage (near-black club monolith, blue-white arc) + Aurelia (graphite-violet couture glass).
  ty_voltage: [16, 18, 32], ty_aurelia: [38, 32, 50],
  // Hall of Records — the ancient civic temple: weathered limestone, cleaner column stone, verdigris copper dome.
  ty_archive: [126, 118, 102], ty_archive_col: [150, 142, 124], ty_archive_dome: [78, 138, 118],
  __statue_stone: [116, 114, 118],   // weathered plinth stone for the town-square monument
  // The Echelon — sleek black superyacht: mirror-black hull, faintly lighter deck house, smoked glass.
  ty_yacht: [16, 18, 22], ty_yacht_deck: [30, 33, 40], ty_yacht_glass: [24, 30, 42],
  // Corporate-Assets claimable businesses — a distinct wall tone per storefront type.
  ty_armory: [70, 74, 80], ty_casino: [58, 30, 60], ty_pawn: [74, 62, 44], ty_chem: [76, 92, 70],
  ty_kitchen: [74, 68, 58],
  // The Yards — semi-industrial freight district models (see TYPE_MODEL). The ribbed-steel keys also join METAL_WALL.
  ty_wh_metal: [120, 124, 130], ty_cont_r: [150, 66, 54], ty_cont_b: [56, 84, 120], ty_cont_g: [70, 104, 80], ty_cont_y: [150, 128, 54],
  ty_pallet: [96, 74, 48], ty_cold: [186, 196, 204], ty_cold_unit: [70, 78, 86], ty_fab_metal: [96, 100, 108], ty_fab_steel: [70, 74, 82],
  ty_wharf: [72, 80, 86], ty_wharf_steel: [64, 70, 78], ty_freight_office: [86, 82, 74], ty_fwd_metal: [110, 116, 122],
  // Halloran's Fix-It — a grease-and-steel repair garage: oil-stained warm concrete block, darker roll-up bays.
  ty_garage: [92, 82, 70], ty_garage_bay: [46, 42, 40],
  // Salvage Rites — the scrapyard: a rusted site shack, oxidised bales of crushed car,
  // and the yellow of a grabber crane that has been repainted exactly once.
  ty_junk_shack: [104, 84, 62], ty_junk_bale: [126, 72, 44], ty_junk_bale_dk: [88, 54, 36], ty_junk_crane: [168, 140, 48],
  // Yards landmark twins — each of these shared a TYPE_MODEL with a same-type neighbour and
  // read as its identical twin from the air, so the more characterful one got promoted to a
  // NAMED_MODEL with its own silhouette (see NAMED_MODELS / drawTypeModel).
  ty_reefer: [198, 204, 208], ty_reefer_blk: [64, 72, 80],           // Coldline: white reefer boxes on a dark plant block
  ty_gantry: [58, 92, 132], ty_stack_dk: [58, 62, 68],               // Interchange Stack: blue rail gantry over ordered rows
  ty_foundry: [88, 78, 70], ty_foundry_stack: [60, 54, 50], ty_slag: [74, 60, 50],   // Ferro: cupola + twin chimneys + slag
  ty_meltoffice: [116, 84, 64], ty_melt_tank: [88, 80, 70],          // Meltwater: older brick, rooftop water tank
  ty_bond_fence: [70, 74, 78], ty_guard: [98, 94, 86],               // Customs Bonded: lit compound + guard box
  // The Lucky Bastard — the city's casino: dark plum stucco under an obscene amount of magenta neon.
  ty_vig: [58, 34, 48], ty_vig_trim: [112, 62, 92],
  // The Ascendant Stronghold — a chrome campus in the western waste (docs/proposals/ascendant-stronghold.md).
  ty_asc_spire: [30, 50, 78], ty_asc_gate: [66, 80, 96], ty_asc_clinic: [150, 178, 190],
  ty_asc_weave: [92, 104, 118], ty_asc_vats: [88, 102, 118], ty_asc_shrine: [20, 28, 44],
  // The South Gate — scorched blast-concrete pylons + a darker riveted parapet cap.
  ty_gate: [78, 76, 74], ty_gate_dk: [44, 42, 44],
  // Citadel Financial — the only marble in Ward Nine: cold white stone, brighter
  // columns standing proud of it, and a dark bronze entrance band.
  ty_marble: [172, 170, 164], ty_marble_col: [198, 196, 190], ty_marble_bronze: [86, 62, 34],
  // The Reach — grim-dark frontier: patched steel, sun-bleached plate, poured slag, salvaged neon.
  // Every wall carries dust and rust; the corrugated keys join METAL_WALL for a ribbed, windowless read.
  ty_reach_hangar: [126, 108, 88], ty_reach_rust: [128, 74, 46], ty_reach_shack: [96, 82, 64],
  ty_reach_saloon: [104, 82, 58], ty_reach_saloon_dk: [66, 50, 36], ty_reach_board: [120, 96, 62],
  ty_reach_dynamo: [92, 88, 80], ty_reach_tank: [104, 72, 46], ty_reach_scorch: [40, 34, 30],
  ty_reach_motel: [110, 100, 88], ty_reach_motel_roof: [72, 58, 44], ty_reach_water: [96, 84, 68],
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
  gun_shop:         { a: 'citycore',   h: 0.13 }, // squat riveted blockhouse
  casino:           { a: 'marquee',    h: 0.17 }, // neon-drowned gambling house
  fence:            { a: 'citycore',   h: 0.13 }, // grimy pawnshop
  chem_supply:      { a: 'industrial', h: 0.16 }, // drum-stacked depot
  // Marrow Street — the workaday downtown strip. Low-rise throughout except the
  // department store, which is the only thing on the street with four floors.
  dept_store:       { a: 'citycore',    h: 0.30 }, // Adequate! — the strip's anchor
  hardware:         { a: 'citycore',    h: 0.13 }, // Nuts to That, stock under the awning
  bathhouse:        { a: 'citycore',    h: 0.14 }, // Lather & Lye, venting steam
  noodle_bar:       { a: 'oldcoldwater', h: 0.09 }, // Oyelaran's — one storey, open front
  outfitter:        { a: 'citycore',    h: 0.13 }, // Layers
  bodega:           { a: 'oldcoldwater', h: 0.11 }, // Bodega Vu, on the Ironside corner
  // The Ascendant Stronghold (docs/proposals/ascendant-stronghold.md) — heights come from
  // flags.floors on each facade; these are the archetype/fallback if a model fails to load.
  asc_spire:        { a: 'uptown',     h: 0.50 },
  asc_gate:         { a: 'civic',      h: 0.12 },
  asc_clinic:       { a: 'civic',      h: 0.16 },
  asc_weave:        { a: 'industrial', h: 0.20 },
  asc_vats:         { a: 'industrial', h: 0.24 },
  asc_shrine:       { a: 'citycore',   h: 0.30 },
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
// Floor counts nudged UP for the low-rise commercial/civic types: a 1-storey pancake in a
// dense ~50-year-future city reads wrong, so a corner shop is small-mixed-use, a soundstage
// a tall clear-span volume, a bar/club a couple of storeys. Raises BOTH the rendered mass and
// the CFIT collision ceiling (both key off floorsOf), so the taller look stays hittable.
// TYPE_FLOORS / FLOOR_Z now live in client/shared/skyline-scale.js — the cold
// open's closing flythrough renders the same skyline as a wireframe and cannot
// import this file to get them. Same numbers, one home.
function floorsOf(cell) { return floorsFor(cell && cell.bt, cell && cell.flr); }
// Deterministic building height for a cell: floors × per-storey, with a small stable
// jitter off the seed so same-type neighbours aren't a dead-flat skyline.
function floorHeight(cell, seed) {
  return floorsOf(cell) * FLOOR_Z * (0.9 + frac(seed) * 0.2) * RENDER_TUNE.bldgH * (RENDER_TUNE.bldgStretch || 1);
}

// Building footprint half-width (tile units) — a building fills most of its own tile. This
// is the SAME value the CFIT collision sweep reads (cockpit.js imports it) so a plane hits a
// tower's mass exactly where its base is drawn, not a tiny box at the tile centre. Scaled by
// the bldgFoot tuning knob at both the draw and the collision sites so they never drift.
// Defined in client/shared/skyline-scale.js and re-exported here, because
// cockpit.js's collision sweep imports it from this module. Live-tunable via the
// dev-panel "Bldg width" slider (RENDER_TUNE.bldgFoot).
export { BUILDING_FOOT };

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
  // A rooftop pad (a `bt` building tile that also carries an airfield_id) keeps its
  // mass — the tower is still there to fly into; only bare field surfaces are clear.
  if (k === 'air' || cell.self || (k === 'field' && !cell.bt) || k === 'nofly'
      || !bi || bi === 'water' || bi === 'parkland' || bi === 'badlands' || !cell.bt) return 0;
  const seed = (wx + 512) * 73 + (wy + 512) * 149;
  return floorHeight(cell, seed);
}

// Building roof altitude in FEET AGL — the COLLISION counterpart to buildingHeightZ (which is the
// render's stylised world-z). The shared source of truth between draw and collision is the FLOOR
// COUNT: the renderer extrudes floors into world-z for a pleasing skyline, but the camera's eye-height
// is a √-compressed function of altitude, so that world-z can't also be linear in real feet. So the
// sim collides in real feet straight off the floors — a 1-storey shop ≈ 12 ft, a 22-storey tower ≈
// 264 ft — which both reads sensibly and stops the old flat hz·600 from CFIT-ing you a third of a
// mile above a corner shop. Returns 0 for any tile with no solid building (reuses buildingHeightZ's gate).
export const FT_PER_FLOOR = 12;   // realistic storey height (ft) used for collision altitudes
export function buildingRoofFt(wx, wy, cell) {
  if (buildingHeightZ(wx, wy, cell) <= 0) return 0;
  return floorsOf(cell) * FT_PER_FLOOR;
}

// Roof altitude in FEET at one specific point on a tile — the per-segment counterpart to
// buildingRoofFt, which answers for the whole tile as a single square.
//
// What this fixes. Collision used to be one axis-aligned box of half-width BUILDING_FOOT with its
// roof at floors × 12 ft, and the models draw nothing like that: an office tower extrudes to 1.7×
// its storey stack, Halcyon to 2.9×, and none of those multipliers ever reached the sim — so you
// flew through the top two thirds of the tallest buildings in the city. Meanwhile the bank's
// stylobate is WIDER than the collision square and its attic narrower, so you also clipped mass
// that wasn't there and passed through mass that was. Reading the captured segments makes what you
// hit the thing you can see, including the gap between a tower and its low wing on the same tile.
//
// Returns 0 when the probe is inside no segment — which is now a real answer rather than an
// approximation, and the reason a plaza between two wings is finally flyable.
//
// Deliberately reads the LIVE capture rather than the baked file: models whose shape varies with
// the tile seed (rooftop clutter) collide as they are actually drawn on that tile.
export function buildingRoofFtAt(wx, wy, cell, px, py) {
  if (buildingHeightZ(wx, wy, cell) <= 0) return 0;
  const seed = (wx + 512) * 73 + (wy + 512) * 149;
  const m = modelFor(cell);
  const floors = floorsOf(cell);
  if (!m) {
    // No dedicated model (a biome archetype) — the old square, unchanged.
    const foot = BUILDING_FOOT * (RENDER_TUNE.bldgFoot || 1);
    return (Math.abs(px - wx) <= foot && Math.abs(py - wy) <= foot) ? floors * FT_PER_FLOOR : 0;
  }
  const segs = shapeForModel(m, seed);
  if (!segs || !segs.length) return floors * FT_PER_FLOOR;
  const h = floorHeight(cell, seed);
  if (!(h > 0)) return 0;
  const fh = (BUILDING_FOOT + frac(seed + 2) * 0.06) * (RENDER_TUNE.bldgFoot || 1);
  // Into the model's own frame: undo the entrance rotation, then per segment undo its yaw.
  const E = faceVec(cell.ent), th = Math.atan2(-E[0], E[1]), ct = Math.cos(th), st = Math.sin(th);
  const ox = px - wx, oy = py - wy;
  const lx = ox * ct + oy * st, ly = -ox * st + oy * ct;
  const V = (p) => p[0] * fh + p[1] * h + p[2];
  const ftPerZ = (floors * FT_PER_FLOOR) / h;   // world-z → feet, via the storey stack both agree on
  let best = 0;
  for (const s of segs) {
    const cx = V(s.cx), cy = V(s.cy);
    const top = V(s.z1) * ftPerZ;
    if (top <= best) continue;                   // can't raise the answer — skip the containment maths
    let dx = lx - cx, dy = ly - cy, inside = false;
    if (s.kind === 'box') {
      if (s.yaw) { const c = Math.cos(-s.yaw), n = Math.sin(-s.yaw); const rx = dx * c - dy * n; dy = dx * n + dy * c; dx = rx; }
      const w = Math.min(V(s.hwRaw), 0.44);      // the same clamp draw3DBoxAt applies internally
      inside = Math.abs(dx) <= w && Math.abs(dy) <= w;
    } else if (s.kind === 'drum') {
      const r = Math.max(V(s.rb), V(s.rt));
      inside = dx * dx + dy * dy <= r * r;
    } else if (s.kind === 'barrel') {
      inside = Math.abs(dx - V(s.cxL)) <= V(s.hl) && Math.abs(dy) <= V(s.hw);
    } else {
      inside = Math.abs(dx) <= V(s.hx) && Math.abs(dy) <= V(s.hy);
    }
    if (inside) best = top;
  }
  return best;
}
// The widest any model can reach from its tile centre, for a cheap reject before the per-segment
// test. draw3DBoxAt clamps a footprint half-width to 0.44, and offset sub-parts (a forecourt vat, a
// porch post) sit outside that — so this is deliberately generous. Being too big only costs a few
// wasted containment tests; being too small would silently make buildings non-solid at the edges.
export const MODEL_MAX_EXTENT = 1.0;

// Shared climb-out corridor test: a building dead ahead and low, right off the runway, is
// culled from the render entirely (see drawWorldObjects) so it never draws — and per the
// "must be visible to collide" rule, the CFIT sweep in cockpit.js skips the exact same tiles
// via this helper, so a building that isn't drawn can't hurt you either. f = forward distance,
// lat = lateral offset from the flight-path centerline (both in tile units), height = 0..1
// eye-height fraction. Returns false when the renderer would have culled it (corr <= 0).
// Capped to CLIMBOUT_MAX_F tiles ahead so this only shields the immediate runway departure —
// NOT any low pass elsewhere in the city, where buildings collide normally. NOTE: this is now
// a COLLISION-only shield — the renderer always draws these buildings (a building in view never
// disappears), so during climb-out you SEE the departure towers and out-climb them rather than
// them vanishing. 4.5 tiles covers a heavy/jet ground roll (Leviathan, Reaper); a light Mayfly
// is airborne and climbing well inside this, so widening it doesn't cost the lighter craft.
export const CLIMBOUT_MAX_F = 4.5, CLIMBOUT_LAT_IN = 0.3, CLIMBOUT_LAT_OUT = 0.2;
// The renderer's own near/far visibility window (drawWorldObjects) — a building this close
// (about to pass under/behind you) or this far (still fading in) isn't really "on the glass"
// yet. Collision must never fire on a tile outside this window, or a hit can land on
// something the player couldn't actually have seen.
export const VISIBLE_NEAR_F = 0.05, VISIBLE_FAR_F = 34;   // long skyline — buildings draw out to 34 tiles (the server sends a 36-tile map window); only the last HAZE_BAND tiles fade, so the distance reads crisp rather than hazed
export function climbOutClear(f, lat, height) {
  if (!(f > 0.1 && f < CLIMBOUT_MAX_F && height < 0.2)) return true;
  return clamp((Math.abs(lat) - CLIMBOUT_LAT_IN) / CLIMBOUT_LAT_OUT, 0, 1) > 0;
}

const TR = () => Math.max(0.5, RENDER_TUNE.texRes || 1);
// Palette keys that render as CORRUGATED METAL SIDING (vertical ribs + rivets) instead of the
// default windowed curtain wall — for hangars/sheds, which shouldn't carry lit office windows.
const METAL_WALL = new Set(['ty_hangarmetal', 'ty_wh_metal', 'ty_cont_r', 'ty_cont_b', 'ty_cont_g', 'ty_cont_y', 'ty_cold', 'ty_fab_metal', 'ty_fwd_metal', 'ty_studio', 'ty_ksab', 'ty_reach_hangar', 'ty_reach_rust', 'ty_reach_dynamo', 'ty_reach_tank', 'ty_reefer', 'ty_stack_dk', 'ty_melt_tank']);   // ...+ sound-stage shells: a stage is a windowless ribbed-panel clear-span box, never a windowed block
const GLASS_WALL = new Set(['ty_halcyon', 'ty_solenne', 'ty_ksab_glass']);   // curtain-glass skins: floor-plate striping + sky sheen instead of a window grid
const DECO_WALL = new Set(['ty_meridian']);   // bespoke art-deco limestone: reeded vertical piers + tall paired windows + chevron spandrels (The Meridian)
function wallTex(biome, night) {
  const tr = TR(), nite = night > 0.4;
  return getTex('wall:' + biome + (nite ? ':n' : '') + ':' + tr, () => {
    const W = Math.round(16 * tr), H = Math.round(32 * tr), c = texCanvas(W, H), g = c.getContext('2d');
    const w = WALL_COL[biome] || [52, 56, 66];
    g.fillStyle = `rgb(${w[0]},${w[1]},${w[2]})`; g.fillRect(0, 0, W, H);
    if (METAL_WALL.has(biome)) {   // ribbed steel siding: alternating shaded vertical bands + rivet rows
      const rib = Math.max(2, Math.round(3 * tr));
      for (let x = 0; x < W; x += rib) {
        const k = (x / rib) % 2 ? 1.16 : 0.82;   // catch-light / shadow face of each corrugation
        g.fillStyle = `rgb(${Math.min(255, w[0] * k) | 0},${Math.min(255, w[1] * k) | 0},${Math.min(255, w[2] * k) | 0})`;
        g.fillRect(x, 0, Math.max(1, rib - 1), H);
      }
      for (let y = 4 * tr; y < H; y += 10 * tr) for (let x = 1 * tr; x < W; x += rib * 2) { g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x | 0, y | 0, Math.max(1, tr | 0), Math.max(1, tr | 0)); }   // rivets
      return c;
    }
    if (GLASS_WALL.has(biome)) {   // futuristic curtain glass: a blue sky-reflection sheen + STRONG horizontal floor plates (no window grid)
      const top = nite ? [40, 88, 120] : [140, 190, 220], bot = nite ? [20, 48, 72] : [98, 146, 184];   // mild top→sill glass gradient
      const vg = g.createLinearGradient(0, 0, 0, H); vg.addColorStop(0, `rgb(${top[0]},${top[1]},${top[2]})`); vg.addColorStop(1, `rgb(${bot[0]},${bot[1]},${bot[2]})`);
      g.fillStyle = vg; g.fillRect(0, 0, W, H);
      const sg = g.createLinearGradient(0, 0, W, 0);   // a soft vertical reflection streak = glassy catch-light
      sg.addColorStop(0, 'rgba(230,244,255,0)'); sg.addColorStop(0.3, 'rgba(230,244,255,0.26)'); sg.addColorStop(0.46, 'rgba(230,244,255,0)'); sg.addColorStop(1, 'rgba(230,244,255,0)');
      g.fillStyle = sg; g.fillRect(0, 0, W, H);
      const fl = Math.max(3, Math.round(6 * tr)), px = Math.max(1, tr | 0);   // one floor plate every ~6px
      for (let y = fl; y < H; y += fl) {
        g.fillStyle = nite ? 'rgba(150,214,244,0.5)' : 'rgba(216,236,250,0.6)'; g.fillRect(0, y - px, W, px);   // slab edge catches the light
        g.fillStyle = nite ? 'rgba(8,20,32,0.6)' : 'rgba(24,46,70,0.42)'; g.fillRect(0, y, W, px);              // spandrel shadow beneath
        if (nite && (Math.round(y / fl) * 13) % 4 === 0) { g.fillStyle = 'rgba(255,214,150,0.55)'; g.fillRect(0, y - px, W, px); }   // a few warm-lit occupied floors
      }
      return c;
    }
    if (DECO_WALL.has(biome)) {   // The Meridian — bespoke ART-DECO limestone: reeded vertical piers framing tall
      //                             paired windows over chevron spandrel panels; warm-lit occupied floors at night.
      const W2 = Math.round(32 * tr), H2 = Math.round(56 * tr), c2 = texCanvas(W2, H2), g2 = c2.getContext('2d');
      const vg = g2.createLinearGradient(0, 0, 0, H2);   // warm limestone, faintly darker toward the base
      vg.addColorStop(0, `rgb(${Math.min(255, w[0] + 12)},${Math.min(255, w[1] + 10)},${Math.min(255, w[2] + 8)})`);
      vg.addColorStop(1, `rgb(${w[0] - 10 | 0},${w[1] - 10 | 0},${w[2] - 10 | 0})`);
      g2.fillStyle = vg; g2.fillRect(0, 0, W2, H2);
      for (let i = 0; i < Math.round(120 * tr); i++) { const rx = frac(i * 3.1) * W2 | 0, ry = frac(i * 5.7) * H2 | 0; g2.fillStyle = `rgba(0,0,0,${0.03 + frac(i) * 0.05})`; g2.fillRect(rx, ry, 1, 1); }   // stone grain
      const bay = Math.max(6, Math.round(8 * tr)), reed = Math.max(1, Math.round(1.4 * tr)), floor = Math.max(6, Math.round(8 * tr)), px = Math.max(1, tr | 0);
      for (let bx = 0; bx < W2; bx += bay) {
        g2.fillStyle = 'rgba(255,248,230,0.20)'; g2.fillRect(bx, 0, reed, H2);              // reeded pier: lit edge
        g2.fillStyle = 'rgba(0,0,0,0.26)'; g2.fillRect(bx + reed, 0, reed, H2);             //             + shadow edge → a 3D vertical rib
        const winX = bx + reed * 2 + px, winW = bay - reed * 2 - px * 2;
        if (winW < 2) continue;
        for (let fy = Math.round(2 * tr); fy < H2 - floor * 0.4; fy += floor) {
          const winH = Math.max(2, floor - Math.round(3 * tr));
          const lit = nite && (((Math.round(bx / tr) * 7 + Math.round(fy / tr) * 13) % 5) < 2);
          if (nite) {
            g2.fillStyle = lit ? 'rgb(255,214,140)' : 'rgb(15,20,30)'; g2.fillRect(winX, fy, winW, winH);
            if (lit) { g2.fillStyle = 'rgba(255,180,90,0.45)'; g2.fillRect(winX, fy + winH - px, winW, px); }   // warm sill spill
          } else {
            const wgt = g2.createLinearGradient(0, fy, 0, fy + winH);
            wgt.addColorStop(0, 'rgb(150,178,202)'); wgt.addColorStop(1, 'rgb(78,104,128)');   // cool sky-reflected glazing
            g2.fillStyle = wgt; g2.fillRect(winX, fy, winW, winH);
          }
          g2.fillStyle = 'rgba(26,22,18,0.75)';                                             // muntins: centre mullion + upper transom
          g2.fillRect(winX + (winW >> 1), fy, px, winH);
          g2.fillRect(winX, fy + Math.round(winH * 0.34), winW, px);
          const spTop = fy + winH, spH = floor - winH;                                      // chevron spandrel beneath (bronze zigzag)
          if (spH >= 2) { g2.strokeStyle = 'rgba(150,108,56,0.65)'; g2.lineWidth = Math.max(1, px); g2.beginPath(); g2.moveTo(winX, spTop + spH - 1); g2.lineTo(winX + winW / 2, spTop + 1); g2.lineTo(winX + winW, spTop + spH - 1); g2.stroke(); }
        }
      }
      return c2;
    }
    const N = Math.round(60 * tr);
    for (let i = 0; i < N; i++) { const rx = frac(i * 3.1) * W | 0, ry = frac(i * 5.7) * H | 0; g.fillStyle = `rgba(0,0,0,${0.05 + frac(i) * 0.06})`; g.fillRect(rx, ry, 1, 1); }
    const xs = 4 * tr, ys = 5 * tr, ww = Math.max(1, 2 * tr), wh = Math.max(1, 3 * tr);
    for (let y = 3 * tr; y < H - 2 * tr; y += ys) for (let x = 2 * tr; x < W - 2 * tr; x += xs) {
      // Scatter lit windows in 2D. The old (x*7 + y*13) % 5 test degenerated at ys=5*tr — the row
      // term vanished mod 5, so whole columns lit identically on every floor (the "tiled" stripes).
      // frac() hashes both indices, so occupancy varies per-window with no visible grid alignment.
      const lit = frac(Math.round(x / tr) * 2.3 + Math.round(y / tr) * 7.9 + 0.5) < (nite ? 0.55 : 0.18);
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
// Flat wall colour for the LOD path: a far/small wall (below RENDER_TUNE.wallLodPx on screen) fills
// this solid instead of running the perspective-correct column-split textured blit — its window grid
// is an aliased blur at that size anyway. It is the AVERAGE colour of the actual baked wall texture
// (1×1 box-filter, memoised), NOT the raw palette base — so the flat fill tone-MATCHES the textured
// blit and a building no longer visibly changes colour as it crosses the LOD threshold while you fly
// toward/away from it. Returns [r,g,b]; the caller lerps the day/night pair across the dusk band.
const _texAvg = new Map();
function flatWallCol(biome, night) {
  const key = 'wallavg:' + biome + (night > 0.4 ? ':n' : '');
  let c = _texAvg.get(key);
  if (!c) {
    const s = texCanvas(1, 1), g = s.getContext('2d');
    g.imageSmoothingEnabled = true; g.drawImage(wallTex(biome, night), 0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data; c = [d[0], d[1], d[2]]; _texAvg.set(key, c);
  }
  return c;
}
// Affine texture-mapped triangle (the Mode-7 warp). Maps texture-space triangle
// (s0,s1,s2) onto screen triangle (d0,d1,d2). Composes with the current transform.
function texTri(ctx, img, s0, s1, s2, d0, d1, d2, smooth) {
  const sx1 = s1[0] - s0[0], sy1 = s1[1] - s0[1], sx2 = s2[0] - s0[0], sy2 = s2[1] - s0[1];
  const det = sx1 * sy2 - sx2 * sy1; if (Math.abs(det) < 1e-6) return;
  const dx1 = d1[0] - d0[0], dy1 = d1[1] - d0[1], dx2 = d2[0] - d0[0], dy2 = d2[1] - d0[1];
  const a = (dx1 * sy2 - dx2 * sy1) / det, b = (dy1 * sy2 - dy2 * sy1) / det;
  const cc = (dx2 * sx1 - dx1 * sx2) / det, d = (dy2 * sx1 - dy1 * sx2) / det;
  const e = d0[0] - a * s0[0] - cc * s0[1], f = d0[1] - b * s0[0] - d * s0[1];
  ctx.save();
  ctx.beginPath(); ctx.moveTo(d0[0], d0[1]); ctx.lineTo(d1[0], d1[1]); ctx.lineTo(d2[0], d2[1]); ctx.closePath(); ctx.clip();
  // Nearest-neighbour is crisp when the texture is MAGNIFIED (near walls), but a minified texture
  // (a far tower shrunk below its texel size) then aliases — fine detail like the Meridian's reeded
  // piers crawls/flickers as the camera moves. Callers pass smooth=true when they know they're
  // minifying, so the far blit bilinear-filters (kills the shimmer) while near walls stay crisp.
  ctx.transform(a, b, cc, d, e, f); ctx.imageSmoothingEnabled = !!smooth; ctx.drawImage(img, 0, 0);
  ctx.restore();
}
function drawTexQuad(ctx, img, P0, P1, P2, P3, smooth) {
  const W = img.width, H = img.height;
  texTri(ctx, img, [0, 0], [W, 0], [W, H], P0, P1, P2, smooth);
  texTri(ctx, img, [0, 0], [W, H], [0, H], P0, P2, P3, smooth);
}
// Perspective-correct textured wall quad. The affine texTri above interpolates texture coords
// linearly in SCREEN space, so a windowed wall viewed at a steep angle (near edge far closer than
// the far edge) kinks along the two-triangle diagonal — the window grid warps. Fix: split the quad
// into vertical columns and put each seam at its perspective-correct u (1/w is linear in screen
// space, so u = (s/fR)/((1-s)/fL + s/fR) for screen-linear s). A building wall is vertical ⇒ each
// vertical edge has constant depth (fL top==bottom, fR top==bottom), so no vertical correction is
// needed — columns alone straighten the windows. fL/fR are the camera depths of the left/right edges.
function drawTexQuadP(ctx, img, P0, P1, P2, P3, fL, fR, smooth) {
  fL = Math.max(fL, 1e-3); fR = Math.max(fR, 1e-3);
  const ratio = Math.max(fL, fR) / Math.min(fL, fR);
  if (ratio < 1.15) { drawTexQuad(ctx, img, P0, P1, P2, P3, smooth); return; }   // near flat-on: one affine quad is fine (and cheap)
  const W = img.width, H = img.height, K = Math.min(12, Math.max(2, Math.ceil(ratio * 1.5)));
  const lerp = (A, B, t) => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
  let tL = P0, bL = P3, uL = 0;   // P0 top-left, P1 top-right, P2 bottom-right, P3 bottom-left
  for (let k = 1; k <= K; k++) {
    const s = k / K, u = (s / fR) / ((1 - s) / fL + s / fR);
    const tR = lerp(P0, P1, s), bR = lerp(P3, P2, s);
    texTri(ctx, img, [uL * W, 0], [u * W, 0], [u * W, H], tL, tR, bR, smooth);
    texTri(ctx, img, [uL * W, 0], [u * W, H], [uL * W, H], tL, bR, bL, smooth);
    tL = tR; bL = bR; uL = u;
  }
}

// The Mode-7 camera: world tile-offset (dx,dy from the craft) + height wz → screen. When
// `chase` = { back, up } is given (external view), the camera physically sits `back` tiles
// BEHIND and `up` world-z ABOVE the craft — a real 3rd-person chase camera looking up the
// craft's own tail, so the whole world renders from behind the aircraft, not the cockpit.
function makeCam(W, horizonY, depth, v, chase) {
  const R = v.map ? (v.map.length - 1) / 2 : 0;
  const EHbase = Math.max(0.05, RENDER_TUNE.eh + (v.height || 0) * RENDER_TUNE.climbLift);   // additive + floor: altitude adds real eye-height so you climb above buildings; floor keeps the runway/ground from collapsing at eh→0
  const back = chase ? chase.back : 0, EH = Math.max(0.05, EHbase + (chase ? chase.up : 0));   // floor the summed eye-height so a low vertical orbit never drops the camera below the terrain
  const hd = (v.heading || 0) * Math.PI / 180, sinh = Math.sin(hd), cosh = Math.cos(hd);
  const off = v.mapOffset, ox = off ? off.x : 0, oy = off ? off.y : 0;
  const cx = W / 2, FL = (W / 2) / 1.15 * (RENDER_TUNE.fov || 1);   // fov<1 compresses the world laterally into a tighter tunnel
  // The chase offset shifts everything `back` tiles forward of the camera (f += back); lateral
  // is unchanged. up raises the eye height (EH), tipping the nose of the view down onto the craft.
  const proj = (dx, dy, wz) => { const bx = dx + back * sinh, by = dy - back * cosh; const f = Math.max(0.06, bx * sinh - by * cosh), l = bx * cosh + by * sinh; return { sx: cx + (l / f) * FL, sy: horizonY + depth * (EH - wz) / f, f }; };
  const projFL = (aa, s, wz) => { const f = Math.max(0.06, aa + back); return { sx: cx + (s / f) * FL, sy: horizonY + depth * (EH - (wz || 0)) / f, f }; };
  return { R, sinh, cosh, ox, oy, proj, projFL, EH, EHbase, back, FL };   // EH/EHbase/FL exposed so traffic, the own-ship and the volumetric clouds can be placed + sized relative to the world camera
}

// ── Depth-sorted face queue (painter's order without a z-buffer) ─────────────────────────────
// A 2D canvas has no depth buffer, so sub-parts of ONE building painted in code order would over-
// paint nearer geometry — a tower drawn after the terminal shows THROUGH it, a marquee shows through
// its own tower. While a sink is active (beginFaces), the building drawers don't paint immediately:
// each face is queued as { d: camera-depth, fn }, and flushFaces() paints them BACK→FRONT (largest
// `d` first). drawWorldObjects opens ONE shared sink for the whole tile loop, so a building's faces
// occlude each other AND their neighbours correctly; between-building order is the real per-face depth.
// Outside a sink (FACE_SINK null) every emitFace paints immediately — so the yacht, deck, HUD and any
// non-building caller are completely unaffected.
let FACE_SINK = null;
// A building's floating adornments (glows, beacons, masts, signs, light-runners, holo ads) once queued
// at a global −∞ "on top" depth so they'd paint last and always sit on top of their own building. But
// −∞ sorts them last GLOBALLY, so a decoration on a FAR tower painted straight through any NEARER
// building in front of it (the "lights from another building showing through this one" bug). `decoDepth`
// instead gives an adornment a REAL camera depth: its own anchor distance, lifted DECO_LIFT tiles forward
// so it still beats its own host walls (which span ±~0.44 tile around the anchor), but far less than the
// ~1 tile gap to any building actually in front — so a nearer building now correctly occludes it.
const DECO_LIFT = 0.6;
const decoDepth = (...fs) => Math.min(...fs) - DECO_LIFT;
// N64 distance fog, shared by the Mode-7 floor and the building pass so the horizon dissolves as ONE
// wall (ground + skyline fade to the same sky colour over the same near→far band). FOG_NEAR/FAR are in
// camera-forward tile units; FOG_FAR = the building draw limit (VISIBLE_FAR_F), so the farthest towers
// hit full fog exactly where they'd otherwise pop in. FOG_STATE is set per-frame by drawWorldObjects
// (null when fog is off or outside the world pass) and read by draw3DBoxAt to overlay each face.
const FOG_NEAR = 6, FOG_FAR = 34;
let PERF_DS = 0;   // adaptive Mode-7 downscale bump (0..4), set per-frame in paintWindshield off smoothed frameMs; added to RENDER_TUNE.pixel in drawMode7Floor
let FOG_STATE = null;
function fogWeight(f) { if (!FOG_STATE) return 0; const ff = clamp((f - FOG_NEAR) / (FOG_FAR - FOG_NEAR), 0, 1); return ff * ff * FOG_STATE.amt; }
// Per-wall Gouraud vertex light, tinted for a POST-APOCALYPTIC CYBERPUNK city: not a warm sunny key
// but a toxic/neon one. Palette (0..255) lerps day→night by sky.night: by day the light is a sickly
// sodium-haze (dusty amber key, pale green-grey sky-catch, cold blue-grey base shadow); by night it's
// neon (magenta key spill, teal-cyan sky glow, indigo-black shadow). LIGHT_STATE is set per-frame by
// drawWorldObjects and read by draw3DBoxAt to shade each wall (sun-facing = warm/neon catch up top,
// shadow-facing = cool + dark at the base). Null when off or outside the world pass.
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };   // '#rrggbb' → [r,g,b]; palette lives in RENDER_TUNE (live colour pickers)
let LIGHT_STATE = null;
function beginFaces() { FACE_SINK = []; }
function emitFace(depth, fn) { if (FACE_SINK) { FACE_SINK.push({ d: depth, fn }); if (PERF.on) PERF.n.faces++; } else fn(); }
function flushFaces() { const s = FACE_SINK; if (!s) return; FACE_SINK = null; s.sort((a, b) => b.d - a.d); for (const e of s) e.fn(); }

// ── Frame profiler ───────────────────────────────────────────────────────────
// Off by default and free when off (one boolean test per phase). Exists to answer ONE question
// before anyone optimises anything: where does the frame actually go? The guess is cheap and
// usually wrong — this file already carries an adaptive Mode-7 downscale (PERF_DS), which is
// evidence the ground plane was once the bottleneck, and that says nothing about today.
//
// The load-bearing split is BUILD vs FLUSH inside the world pass. Every building queues closures
// into FACE_SINK and nothing paints until flushFaces sorts them, so "buildings are slow" has two
// completely different cures: if BUILD dominates, skip whole arms at distance (LOD); if FLUSH
// dominates, the cost is the sort plus fill-rate and cutting arms buys much less.
//
// Console usage, in the flight sim:
//   __wsProfile(true)    // start; prints a table every 2s
//   __wsProfile(false)   // stop
// Keys are dynamic so the cockpit can add its own sim phases to the same table — the first profile
// run showed paintWindshield was only a THIRD of the real frame, which makes a windshield-only
// profiler actively misleading. `frame` is whatever the caller declares the whole frame to be.
const PERF = { on: false, t: {}, n: {}, stack: [], last: 0, frames: 0 };
const PERF_COUNTS = ['faces', 'arms', 'adorn', 'grads', 'lod', 'culled'];
function perfReset() {
  PERF.t = {}; PERF.n = {}; PERF.stack.length = 0; PERF.frames = 0;
  for (const k of PERF_COUNTS) PERF.n[k] = 0;
}
// A real stack, so a phase can contain sub-phases (frame ⊃ sim:paint ⊃ world:flush). Times are
// INCLUSIVE — a parent's number contains its children's — which is what you want when the question
// is "which branch do I chase", not "which leaf is hot".
export function perfBegin(k) { if (PERF.on) PERF.stack.push(k, performance.now()); }
export function perfEnd() {
  if (!PERF.on || !PERF.stack.length) return;
  const t0 = PERF.stack.pop(), k = PERF.stack.pop();
  PERF.t[k] = (PERF.t[k] || 0) + (performance.now() - t0);
}
const pBegin = perfBegin, pEnd = perfEnd;
export function setWindshieldProfiler(on) {
  PERF.on = !!on; perfReset(); PERF.last = performance.now();
  return PERF.on ? 'flight-sim profiler ON — table every 2s' : 'flight-sim profiler OFF';
}
export function perfEnabled() { return PERF.on; }
// Call once per rendered frame, after closing the `frame` phase.
export function perfTick() {
  if (!PERF.on) return;
  // Defensive: an early return or a throw between perfBegin/perfEnd would leave the stack dirty and
  // silently mis-attribute every later frame. Clearing per frame bounds the damage to one frame.
  if (PERF.stack.length) PERF.stack.length = 0;
  PERF.frames++;
  const now = performance.now(), span = now - PERF.last;
  if (span < 2000) return;
  const f = PERF.frames || 1, total = PERF.t.frame || 0;
  const rows = Object.keys(PERF.t).filter(k => k !== 'frame' && PERF.t[k] > 0.0001).map(k => ({
    phase: k, 'ms/frame': +(PERF.t[k] / f).toFixed(3),
    '% of frame': total > 0 ? +(PERF.t[k] / total * 100).toFixed(1) : 0,
  })).sort((a, b) => b['ms/frame'] - a['ms/frame']);
  // Only `sim:*` are top-level children of `frame`; the windshield phases nest INSIDE sim:paint, so
  // summing both double-counts (the first run of this printed a nonsensical -7ms).
  const named = rows.filter(r => r.phase.startsWith('sim:')).reduce((s, r) => s + r['ms/frame'], 0);
  const fps = f / (span / 1000), wall = 1000 / fps;
  console.log(`── flight-sim frame profile — ${f} frames, ${fps.toFixed(1)} fps, ${(total / f).toFixed(2)} ms/frame inside the rAF handler`);
  console.table(rows);
  console.log(`   unaccounted inside the handler: ${(total / f - named).toFixed(2)} ms/frame`);
  // The handler is only part of a frame. If wall-clock per frame far exceeds the handler, the rest
  // is the browser rasterising/compositing what we queued — canvas2d fills are GPU work that lands
  // AFTER the handler returns, so heavy fill counts under-report here and show up as this gap.
  console.log(`   outside the handler (browser raster/composite): ${(wall - total / f).toFixed(2)} ms/frame of a ${wall.toFixed(1)} ms wall-clock frame`);
  console.log(`   per frame: ${(PERF.n.faces / f).toFixed(0)} faces queued · ${(PERF.n.arms / f).toFixed(0)} full model arms · ${(PERF.n.lod / f).toFixed(0)} LOD buildings · ${(PERF.n.culled / f).toFixed(0)} occluded ·${(PERF.n.adorn / f).toFixed(0)} adornments · ${(PERF.n.grads / f).toFixed(0)} gradients`);
  perfReset(); PERF.last = now;
}
if (typeof window !== 'undefined') {
  window.__wsProfile = setWindshieldProfiler;
  // The live render knobs, for console experiments (`__wsTune.wallLodPx = 400`). Every one takes
  // effect on the very next frame — same object the ⚙ sliders mutate.
  window.__wsTune = RENDER_TUNE;
}

// ── SHAPE CAPTURE ────────────────────────────────────────────────────────────
// A building's shape isn't data — it's 72 imperative case arms in drawTypeModel. Collision, the
// ground shadow and the cold open all want to KNOW a building's form, and none of them can read
// an arm. So the arms record themselves: when SHAPE_SINK is set, every MASS primitive pushes its
// arguments and returns before doing anything else, and every ADORNMENT primitive no-ops. Run the
// real drawTypeModel against a stub ctx/cam (see captureShape) and out comes the segment list the
// renderer would have drawn — derived from the shipping code rather than transcribed from it.
//
// THE WHOLE POINT: on a real frame SHAPE_SINK is null, so the arms are byte-for-byte unchanged and
// the render is pixel-identical BY CONSTRUCTION, not by anyone eyeballing 72 buildings. Never
// assign this from a paint path; drawWorldObjects asserts it's null.
//
// Records are MODEL-LOCAL (captured at the canonical entrance vector E=[0,1], where facePt is the
// identity) and NORMALIZED — cx/cy/hw/radii are multiples of the `fh` argument, z0/z1 multiples of
// `h`. That's what makes one capture serve every tile and survive the bldgFoot/bldgH/bldgStretch
// sliders, which enter only as multipliers on fh and h.
// The primitives record RAW arguments; captureShape does the de-offsetting and normalization in one
// post-pass. Keeping the guards dumb is deliberate — they sit at the top of the hottest drawing
// functions in the file, and a guard that computes something is a guard that can be wrong.
let SHAPE_SINK = null;
// The model palette currently being captured. Only draw3DBoxAt is handed a palette key; drums,
// barrels and sawtooth roofs take colours or shading closures the LOD renderer can't reuse. So the
// palette rides along ambiently (same idiom as _bladeSign) and every record carries one — which is
// what lets a distant drum be drawn in its real colour instead of a grey guess.
let SHAPE_PAL = null;
// Suppress MASS only. With this set an arm runs normally but its four mass primitives no-op, so
// what reaches the screen is exactly its adornments — neon blades, marquees, glow pools, beacons,
// masts, smoke. That is the whole trick behind the distance LOD: the profile showed running an arm
// costs 3.2ms/frame while QUEUEING its faces costs 14.6ms, so the arm's JS was never the problem.
// Drawing mass from cheap captured segments and still running the arm for its lights keeps every
// landmark identifiable at range — the helix runners on Halcyon, Solenne's crown, the aviation
// beacons that tell you something tall is ahead — while still cutting ~45 faces per building to ~5.
//
// Note the two hand-rolled shells (the bank's dome, the Meridian's cupola) draw straight through
// cam.proj/emitFace rather than a mass primitive, so they survive this and keep their contour at
// range. That's a happy accident of where they live, not a design.
let MASS_OFF = false;
// How much adornment a building is allowed to draw. 2 = everything (what a near building gets and
// what the sim has always done), 1 = only the CHEAP lights, 0 = none.
//
// The tiers are by COST, not by taste, because face count turned out to be the wrong metric
// entirely: a mass face is a flat polygon fill, while glowPool builds a radial gradient and
// neonBlade/marqueeBand set shadowBlur — a software blur pass per draw, and the single most
// expensive thing in canvas2d. Keeping "the lights" wholesale at range kept nearly all the
// expensive work while shedding only the cheap fills, which is why it gave the framerate straight
// back. Tier 1 keeps what carries identity for free — blinking aviation beacons, masts, dishes —
// and drops everything that blurs or builds a gradient.
let ADORN_TIER = 2;
const ADORN_CHEAP = 1, ADORN_RICH = 2;

// One extruded, texture-mapped box between two heights (base wz0 → top wz1): painter-sorted
// walls + an optional roof. Setback towers stack several of these. When a face sink is active the
// walls/roof are queued (per-face depth) instead of painted, so they interleave correctly with the
// rest of the building instead of the whole box landing on top of whatever was drawn before it.
function draw3DBoxAt(ctx, cam, dx, dy, fh, wz0, wz1, biome, seed, night, alpha, roof, yaw, fd) {
  // Shape capture records the RAW fh, ahead of the clamp below. That's load-bearing: 0.44 is an
  // absolute world constant while everything else in a record is a multiple of fh, so a post-clamp
  // number would only be valid at the one footprint it was captured at. Consumers re-apply
  // min(hwRaw * fhLive, 0.44) instead, and the data stays invariant to the bldgFoot slider.
  if (SHAPE_SINK) { SHAPE_SINK.push({ kind: 'box', dx, dy, hwRaw: fh, wz0, wz1, pal: biome, roof: !!roof, yaw: yaw || 0 }); return; }
  if (MASS_OFF) return;   // adornments-only pass — the distance LOD draws this mass from captured segments
  fh = Math.min(fh, 0.44);   // hard cap so even a WIDE model (warehouse/depot fh*1.1+) keeps a setback inside its tile and never bleeds onto the neighbour/road (was 0.48 → capped boxes reached the tile edge)
  // `fd` (optional half-DEPTH) makes the footprint rectangular instead of square. No model arm
  // passes it — they are all square, exactly as before — it exists so the LOD renderer can stand in
  // for a long shed roof without turning a hangar into a cube. Everything below reads `cs`, so a
  // rectangle needs no other change.
  fd = fd === undefined ? fh : Math.min(fd, 0.44);
  // `yaw` (rad, optional) spins the footprint about its centre — buildings never pass it (axis-
  // aligned as before); a heading-aware object like the sailing Echelon passes its heading so the
  // extruded box turns with the hull. cs stays the SSOT the projection + backface cull read from.
  let cs = [[-fh, -fd], [fh, -fd], [fh, fd], [-fh, fd]];
  if (yaw) { const cy = Math.cos(yaw), sy = Math.sin(yaw); cs = cs.map(([a, b]) => [a * cy - b * sy, a * sy + b * cy]); }
  // Raw (unclamped) forward distance of a footprint point — the value proj() clamps to 0.06.
  // f is constant up a vertical edge (height-independent), so this is per footprint CORNER.
  const NEAR_CLIP = 0.08;   // trim walls to this near plane; above proj's 0.06 clamp so trimmed corners project stably
  const rawF = (x, y) => (x + (cam.back || 0) * cam.sinh) * cam.sinh - (y - (cam.back || 0) * cam.cosh) * cam.cosh;
  const cf = cs.map(([a, c]) => rawF(dx + a, dy + c));
  const b = cs.map(([a, c]) => cam.proj(dx + a, dy + c, wz0));
  // Day↔night wall textures used to snap at a hard `night > 0.4` boolean (windows flipped from cool day
  // glazing to warm lit panes in a single frame) while the Gouraud vertex ramp lerped smoothly — a
  // dramatic dusk/dawn colour jump across the whole skyline. Crossfade the two baked variants over a
  // band around 0.4 instead. NB = 0 → pure day texture, 1 → pure night; the night variant is blitted on
  // top of the day one at alpha·NB (both baked opaque, so NB=1 fully replaces it).
  const NB = clamp((night - 0.30) / 0.20, 0, 1);
  const wallDay = wallTex(biome, 0), wallNite = NB > 0.001 ? wallTex(biome, 1) : null, shade = [0.0, 0.16, 0.3, 0.12];
  const flatWall = rgb(mix(flatWallCol(biome, 0), flatWallCol(biome, 1), NB)), WALL_LOD_PX = RENDER_TUNE.wallLodPx || 0;   // small-wall LOD: flat-fill (tone-matched to the tex average) instead of the column-split textured blit
  const faces = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    // Backface cull — draw ONLY the side walls whose outward normal points at the camera.
    // (mx,my) is the face-centre offset from the box axis, i.e. its outward normal; the wall
    // faces the camera when n·(camera − centre) > 0. The camera is at the coord origin in
    // cockpit view, but `back` tiles behind (at −back·sinh, +back·cosh) in the external chase
    // view — fold that in, or the cull picks the wrong walls and you see straight into the box.
    const mx = (cs[i][0] + cs[j][0]) / 2, my = (cs[i][1] + cs[j][1]) / 2;
    if (mx * (dx + mx) + my * (dy + my) + (cam.back || 0) * (mx * cam.sinh - my * cam.cosh) >= 0) continue;   // wall faces away → skip
    faces.push({ af: (b[i].f + b[j].f) / 2, i, j });
  }
  faces.sort((x, y) => y.af - x.af);
  for (const fc of faces) {
    const i = fc.i, j = fc.j;
    // Near-plane CLIP the wall's horizontal edge before projecting. Without this, a front-facing
    // wall whose far corner has crossed BEHIND the eye (happens when you fly close past a building)
    // has that corner clamped to f=0.06 and flung across the screen — the wall smears over the box
    // and you see its far/interior faces (the "inside-out" look). Trim the behind corner to the
    // near plane instead. f varies linearly along the edge, so a plain lerp gives the crossing.
    let ax = dx + cs[i][0], ay = dy + cs[i][1], bx = dx + cs[j][0], by = dy + cs[j][1];
    const fi = cf[i], fj = cf[j];
    if (fi < NEAR_CLIP && fj < NEAR_CLIP) continue;   // wall wholly behind the eye → invisible
    if (fi < NEAR_CLIP) { const s = (NEAR_CLIP - fi) / (fj - fi); ax += (bx - ax) * s; ay += (by - ay) * s; }
    else if (fj < NEAR_CLIP) { const s = (NEAR_CLIP - fj) / (fi - fj); bx += (ax - bx) * s; by += (ay - by) * s; }
    const ti = cam.proj(ax, ay, wz1), tj = cam.proj(bx, by, wz1), bi = cam.proj(ax, ay, wz0), bj = cam.proj(bx, by, wz0);
    const P0 = [ti.sx, ti.sy], P1 = [tj.sx, tj.sy], P2 = [bj.sx, bj.sy], P3 = [bi.sx, bi.sy], sh = shade[i];
    const fL = ti.f, fR = tj.f;   // left/right vertical-edge depths → perspective-correct wall texturing
    const fog = fogWeight(fc.af);
    // Gouraud vertex light (cyberpunk-tinted): dot the wall's outward normal with the key direction →
    // sun/key-facing walls catch the warm/neon tint up top; shadow-facing walls go cool + darker at the
    // base (ambient occlusion). A vertical screen gradient across the wall fakes the per-vertex ramp.
    const topY = (P0[1] + P1[1]) / 2, botY = (P2[1] + P3[1]) / 2;
    const wallPx = Math.abs(botY - topY);   // on-screen wall height → drives the texture LOD (flat-fill when tiny)
    // Minifying when the wall covers fewer screen pixels than the texture has texels in either axis —
    // then the nearest-neighbour blit aliases fine detail (the reeded Meridian piers crawl). Bilinear-
    // filter that far case; keep near/magnified walls crisp. wallW is the wider (near) top-edge run.
    const wallW = Math.max(Math.hypot(P1[0] - P0[0], P1[1] - P0[1]), Math.hypot(P2[0] - P3[0], P2[1] - P3[1]));
    const minify = wallW < wallDay.width || wallPx < wallDay.height;
    // LOD: the vertical ramp only READS on tall near walls. On short/distant walls (a few px high) it's
    // indistinguishable from a flat tint, so skip the gradient object entirely and fill one solid mid
    // colour — same picture, and a dense skyline (mostly far faces) pays almost nothing.
    let litTop = null, litBot = null, litSolid = null;
    if (LIGHT_STATE) {
      const nx = cs[i][0] + cs[j][0], ny = cs[i][1] + cs[j][1], nlen = Math.hypot(nx, ny) || 1;
      const litC = clamp(0.5 + (nx / nlen * LIGHT_STATE.sx + ny / nlen * LIGHT_STATE.sy) * 0.5, 0, 1);
      const tc = mix(LIGHT_STATE.sky, LIGHT_STATE.key, litC), sd = LIGHT_STATE.shadow, s = LIGHT_STATE.str;
      const aTop = s * (0.06 + 0.14 * litC), aBot = s * (0.30 + 0.22 * (1 - litC));
      if (Math.abs(botY - topY) > 18) {   // tall on screen → real gradient
        litTop = `rgba(${tc[0] | 0},${tc[1] | 0},${tc[2] | 0},${aTop.toFixed(3)})`;
        litBot = `rgba(${sd[0]},${sd[1]},${sd[2]},${aBot.toFixed(3)})`;
      } else {   // short/far → one flat fill at the ramp's midpoint
        const mc = mix(tc, sd, 0.5);
        litSolid = `rgba(${mc[0] | 0},${mc[1] | 0},${mc[2] | 0},${((aTop + aBot) * 0.5).toFixed(3)})`;
      }
    }
    // Depth = front-corner f MINUS the same height bias the roof uses (see the roof note below). Stacked
    // concentric boxes on one centre (a stepped tower's tiers + their projecting cornice/frieze bands) have
    // near-equal front-face f, so on a plain painter sort they flip order as the camera bobs and blink in
    // and out — worst on the many-tiered Meridian. Biasing each wall forward by its top height makes the
    // higher tier (nearer the down-looking eye) sort reliably on top, and keeps a box's walls consistent
    // with its own roof. The bias is far below inter-building depth gaps, so it never reorders neighbours.
    emitFace(fc.af - wz1 * 0.02, () => {
      ctx.globalAlpha = alpha;
      // Small/far wall → one flat shaded polygon; near/tall wall → the perspective-correct windowed blit.
      // The lit-ramp + fog overlays below paint on top of either, so a flat-shaded far wall still models.
      if (wallPx < WALL_LOD_PX) { ctx.beginPath(); ctx.moveTo(P0[0], P0[1]); ctx.lineTo(P1[0], P1[1]); ctx.lineTo(P2[0], P2[1]); ctx.lineTo(P3[0], P3[1]); ctx.closePath(); ctx.fillStyle = flatWall; ctx.fill(); }
      else { drawTexQuadP(ctx, wallDay, P0, P1, P2, P3, fL, fR, minify); if (wallNite) { ctx.globalAlpha = alpha * NB; drawTexQuadP(ctx, wallNite, P0, P1, P2, P3, fL, fR, minify); ctx.globalAlpha = alpha; } }
      ctx.beginPath(); ctx.moveTo(P0[0], P0[1]); ctx.lineTo(P1[0], P1[1]); ctx.lineTo(P2[0], P2[1]); ctx.lineTo(P3[0], P3[1]); ctx.closePath();
      if (litTop) {
        const g = ctx.createLinearGradient(0, topY, 0, Math.max(botY, topY + 1));
        g.addColorStop(0, litTop); g.addColorStop(1, litBot); ctx.fillStyle = g; ctx.fill();
      } else if (litSolid) { ctx.fillStyle = litSolid; ctx.fill(); }
      else if (sh) { ctx.fillStyle = `rgba(0,0,0,${sh})`; ctx.fill(); }
      // N64 fog overlay: paint the sky colour over the face, thickening with distance, so the far
      // skyline recedes into the same fog wall as the ground (matched band + colour).
      if (fog > 0.004) { ctx.globalAlpha = alpha * fog; ctx.fillStyle = FOG_STATE.css; ctx.beginPath(); ctx.moveTo(P0[0], P0[1]); ctx.lineTo(P1[0], P1[1]); ctx.lineTo(P2[0], P2[1]); ctx.lineTo(P3[0], P3[1]); ctx.closePath(); ctx.fill(); }
      ctx.globalAlpha = 1;
    });
  }
  // Roof: only when the whole top quad is in front of the eye — a partly-behind roof can't be
  // seen from that angle anyway, and clipping a 4-gon to the near plane would need a polygon split.
  if (roof && cf[0] >= NEAR_CLIP && cf[1] >= NEAR_CLIP && cf[2] >= NEAR_CLIP && cf[3] >= NEAR_CLIP) {
    const t = cs.map(([a, c]) => cam.proj(dx + a, dy + c, wz1));
    const rp = [[t[0].sx, t[0].sy], [t[1].sx, t[1].sy], [t[2].sx, t[2].sy], [t[3].sx, t[3].sy]], rtex = roofTex(biome, night);
    const rf = (t[0].f + t[1].f + t[2].f + t[3].f) / 4, rfog = fogWeight(rf);
    // A horizontal roof quad's depth collapses to its tile centre's f (f is linear in x,y, so the
    // 4-corner average of a centred box = the centre value) — so EVERY concentric roof stacked on one
    // centre (a stepped tower's cornice ledges + the setback roofs beneath them) ties at one depth and
    // z-fights as the camera bobs. Break the tie by height: a higher ledge is nearer the down-looking
    // eye, so bias it forward (smaller depth → painted later → on top). The bias is far below inter-
    // building depth gaps, so it only orders a box's own stacked roofs, never reorders neighbours.
    emitFace(rf - wz1 * 0.02, () => { ctx.globalAlpha = alpha; drawTexQuad(ctx, rtex, rp[0], rp[1], rp[2], rp[3]); if (rfog > 0.004) { ctx.globalAlpha = alpha * rfog; ctx.fillStyle = FOG_STATE.css; ctx.beginPath(); ctx.moveTo(rp[0][0], rp[0][1]); ctx.lineTo(rp[1][0], rp[1][1]); ctx.lineTo(rp[2][0], rp[2][1]); ctx.lineTo(rp[3][0], rp[3][1]); ctx.closePath(); ctx.fill(); } ctx.globalAlpha = 1; });
  }
}
function draw3DBox(ctx, cam, dx, dy, fh, wz, biome, seed, night, alpha) {
  draw3DBoxAt(ctx, cam, dx, dy, fh, 0, wz, biome, seed, night, alpha, true);
}

// The Curtain — the Architect's energy wall sealing the city's land edges. A tall translucent
// shimmer plane standing on the perimeter tile, drawn as ARMS reaching from the tile centre only
// toward its real Curtain neighbours (`cur`: any of 'n','e','s','w'; see curtainRun). A straight
// run carries opposite arms → one clean span; a corner carries an L (e.g. 'nw') and NEVER pokes a
// stray stub into empty air; an endpoint carries a single arm. Purely a landmark; the actual seal
// is a move-gate on flags.curtain, server-side.
const CURTAIN_H = 0.9;   // world-z — taller than any district building, an imposing barrier
function drawCurtainWall(ctx, cam, dx, dy, axis, alpha, now) {
  const NEAR = 0.08;
  const rawF = (x, y) => (x + (cam.back || 0) * cam.sinh) * cam.sinh - (y - (cam.back || 0) * cam.cosh) * cam.cosh;
  const seg = (ax, ay, bx, by) => {
    const fa = rawF(ax, ay), fb = rawF(bx, by);
    if (fa < NEAR && fb < NEAR) return;
    if (fa < NEAR) { const s = (NEAR - fa) / (fb - fa); ax += (bx - ax) * s; ay += (by - ay) * s; }
    else if (fb < NEAR) { const s = (NEAR - fb) / (fa - fb); bx += (ax - bx) * s; by += (ay - by) * s; }
    const tA = cam.proj(ax, ay, CURTAIN_H), tB = cam.proj(bx, by, CURTAIN_H);
    const bA = cam.proj(ax, ay, 0), bB = cam.proj(bx, by, 0);
    emitFace((tA.f + tB.f) / 2, () => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(tA.sx, tA.sy); ctx.lineTo(tB.sx, tB.sy); ctx.lineTo(bB.sx, bB.sy); ctx.lineTo(bA.sx, bA.sy); ctx.closePath();
      const topY = (tA.sy + tB.sy) / 2, botY = (bA.sy + bB.sy) / 2, span = (botY - topY) || 1;
      const pulse = 0.5 + 0.5 * Math.sin(now / 420);
      // Body: a colder, brighter cyan→indigo→violet energy field with a hot white-cyan crown rim.
      const g = ctx.createLinearGradient(0, topY, 0, botY);
      g.addColorStop(0,    `rgba(215,250,255,${0.50 * alpha})`);                    // hot crown rim
      g.addColorStop(0.12, `rgba(120,225,255,${(0.24 + 0.10 * pulse) * alpha})`);
      g.addColorStop(0.55, `rgba(70,150,255,${(0.15 + 0.07 * pulse) * alpha})`);    // deepening indigo field
      g.addColorStop(1,    `rgba(120,110,255,${(0.09 + 0.05 * pulse) * alpha})`);   // violet dissolve near the ground
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g; ctx.fill();
      ctx.clip();
      // Height-fraction point (t: 0=top…1=bottom) on the left(0)/right(1) edge — so scan bands hug
      // the plane's foreshortening instead of running flat across the clip box.
      const lerp = (t, side) => side === 0
        ? { x: tA.sx + (bA.sx - tA.sx) * t, y: tA.sy + (bA.sy - tA.sy) * t }
        : { x: tB.sx + (bB.sx - tB.sx) * t, y: tB.sy + (bB.sy - tB.sy) * t };
      for (let k = 0; k < 10; k++) {
        const t = 1 - ((now / 1400 + k / 10) % 1), pA = lerp(t, 0), pB = lerp(t, 1);
        ctx.strokeStyle = `rgba(200,245,255,${(0.05 + 0.10 * (1 - t)) * alpha})`;   // brighter low, faint high
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pA.x, pA.y); ctx.lineTo(pB.x, pB.y); ctx.stroke();
      }
      // Vertical energy "rain" — short streaks sliding down the field for a shimmering-curtain read.
      const xL = Math.min(tA.sx, tB.sx, bA.sx, bB.sx), xR = Math.max(tA.sx, tB.sx, bA.sx, bB.sx);
      for (let k = 0; k < 5; k++) {
        const sx = xL + (xR - xL) * (Math.sin(k * 12.9898) * 0.5 + 0.5);
        const y0 = topY + span * ((now / 900 + k * 0.37) % 1), y1 = y0 + span * 0.16;
        const vg = ctx.createLinearGradient(0, y0, 0, y1);
        vg.addColorStop(0, 'rgba(220,250,255,0)');
        vg.addColorStop(0.6, `rgba(190,240,255,${0.22 * alpha})`);
        vg.addColorStop(1, 'rgba(220,250,255,0)');
        ctx.strokeStyle = vg; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(sx, y0); ctx.lineTo(sx, y1); ctx.stroke();
      }
      // A hard energised crown line along the very top edge, above the haze.
      ctx.strokeStyle = `rgba(225,252,255,${(0.5 + 0.3 * pulse) * alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tA.sx, tA.sy); ctx.lineTo(tB.sx, tB.sy); ctx.stroke();
      ctx.restore();
    });
  };
  // Pair opposite arms into one clean span where both neighbours exist (no centre seam on a
  // straight run); otherwise reach a half-arm only toward the neighbour that's actually there.
  const n = axis.indexOf('n') >= 0, s = axis.indexOf('s') >= 0, e = axis.indexOf('e') >= 0, w = axis.indexOf('w') >= 0;
  if (n && s) seg(dx, dy - 0.5, dx, dy + 0.5);   // full N–S span
  else if (n) seg(dx, dy, dx, dy - 0.5);          // reach north only
  else if (s) seg(dx, dy, dx, dy + 0.5);          // reach south only
  if (e && w) seg(dx - 0.5, dy, dx + 0.5, dy);   // full E–W span
  else if (e) seg(dx, dy, dx + 0.5, dy);          // reach east only
  else if (w) seg(dx, dy, dx - 0.5, dy);          // reach west only
}

// A faceted vertical DRUM (cylinder/cone) through the world camera — the rounded alternative to
// draw3DBoxAt for towers/tanks that shouldn't read as a blocky box. N side facets run from world-z
// z0→z1, radius rb (bottom)→rt (top), centred on (dx,dy). `style(f, top, bot)` returns a fillStyle
// per facet — `f.nl` is the facet's light dot (0..1, key light from the upper-left), `f.pts` its four
// projected corners, `top`/`bot` its screen-y extent (for a vertical gradient). Back-facing facets are
// culled (same normal·view test the boxes use, chase-`back` folded in) and the rest painted far→near
// for painter depth. `cap` optionally fills the top disc (a flat roof). No wall texture — the caller's
// `style` owns the surface, so this is how a smooth glass/metal skin gets drawn instead of windows.
function drawFacetDrum(ctx, cam, dx, dy, z0, z1, rb, rt, N, alpha, style, cap) {
  // Recorded ahead of the per-facet backface cull below — capture wants the whole solid, not the
  // half of it a stub camera happens to face.
  if (SHAPE_SINK) { SHAPE_SINK.push({ kind: 'drum', dx, dy, wz0: z0, wz1: z1, rb, rt, n: N, cap: !!cap, pal: SHAPE_PAL }); return; }
  if (MASS_OFF) return;   // adornments-only pass — the distance LOD draws this mass from captured segments
  const lx = -0.7, ly = -0.7, bk = cam.back || 0, rm = (rb + rt) / 2, F = [];
  for (let i = 0; i < N; i++) {
    const a0 = i / N * 6.2832, a1 = (i + 1) / N * 6.2832, am = (a0 + a1) / 2, nx = Math.cos(am), ny = Math.sin(am);
    if (nx * (dx + nx * rm) + ny * (dy + ny * rm) + bk * (nx * cam.sinh - ny * cam.cosh) >= 0) continue;   // facet faces away → cull
    const p = [
      cam.proj(dx + Math.cos(a0) * rb, dy + Math.sin(a0) * rb, z0),
      cam.proj(dx + Math.cos(a1) * rb, dy + Math.sin(a1) * rb, z0),
      cam.proj(dx + Math.cos(a1) * rt, dy + Math.sin(a1) * rt, z1),
      cam.proj(dx + Math.cos(a0) * rt, dy + Math.sin(a0) * rt, z1),
    ];
    if (p.some(q => q.f <= 0.08)) continue;
    F.push({ af: (p[0].f + p[1].f + p[2].f + p[3].f) / 4, pts: p, nl: Math.max(0, nx * lx + ny * ly) });
  }
  for (const f of F) {
    const ys = f.pts.map(q => q.sy), fill = style(f, Math.min(...ys), Math.max(...ys)), pts = f.pts, fog = fogWeight(f.af);
    emitFace(f.af, () => { ctx.globalAlpha = alpha; ctx.fillStyle = fill; ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q.sx, q.sy) : ctx.moveTo(q.sx, q.sy)); ctx.closePath(); ctx.fill(); if (fog > 0.004) { ctx.globalAlpha = alpha * fog; ctx.fillStyle = FOG_STATE.css; ctx.fill(); } ctx.globalAlpha = 1; });
  }
  if (cap) {   // top disc — flat roof cap
    const pts = []; let ok = true;
    for (let i = 0; i < N; i++) { const a = i / N * 6.2832, q = cam.proj(dx + Math.cos(a) * rt, dy + Math.sin(a) * rt, z1); if (q.f <= 0.08) { ok = false; break; } pts.push(q); }
    if (ok) { const cd = pts.reduce((s, q) => s + q.f, 0) / pts.length, fog = fogWeight(cd); emitFace(cd, () => { ctx.globalAlpha = alpha; ctx.fillStyle = cap; ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q.sx, q.sy) : ctx.moveTo(q.sx, q.sy)); ctx.closePath(); ctx.fill(); if (fog > 0.004) { ctx.globalAlpha = alpha * fog; ctx.fillStyle = FOG_STATE.css; ctx.fill(); } ctx.globalAlpha = 1; }); }
  }
}
// A horizontal RING at world-z `z`, radius `r`, centred on (dx,dy) — a band line / catwalk rail
// around a drum. Projected through the camera; skipped if any point is behind the near plane.
function drawRing(ctx, cam, dx, dy, z, r, N, strokeStyle, lw, alpha) {
  if (SHAPE_SINK || ADORN_TIER < ADORN_CHEAP) return;   // adornment — a catwalk rail is not mass
  const pts = [];
  for (let i = 0; i <= N; i++) { const a = i / N * 6.2832, p = cam.proj(dx + Math.cos(a) * r, dy + Math.sin(a) * r, z); if (p.f <= 0.08) return; pts.push(p); }
  emitFace(decoDepth(...pts.map(p => p.f)), () => { ctx.globalAlpha = alpha; ctx.strokeStyle = strokeStyle; ctx.lineWidth = lw; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.stroke(); ctx.globalAlpha = 1; });
}
// A curved BARREL ROOF (half-cylinder) sitting on a hangar's walls — the rounded shed roof a box
// can't make. Built in the building's LOCAL frame via `F(lx,ly)` (so it aligns to the frontage):
// the arch spans local-x ∈ [cxL±hl] and sweeps along local-y ∈ [±hw], springing from `wallTop` to
// `wallTop+archH`. Roof panels are shaded by a top key light + painted far→near (convex, so painter
// order is exact); the two arched gable tympana are backface-culled against the camera. `base` = the
// roof RGB. Draw AFTER the wall box so it caps it.
function drawBarrelRoof(ctx, cam, F, cxL, hl, hw, wallTop, archH, NF, alpha, base) {
  // This one takes the model-local frame as a closure rather than world coords, so capture reads
  // the anchor out of F and keeps the local extents verbatim — under the canonical E=[0,1] facePt
  // is the identity, so they're already in the frame every consumer wants.
  // `base` (the roof RGB) is captured too — it's the one colour the LOD renderer can't derive from a
  // palette key, and without it a distant barrel roof is a guess instead of the same roof.
  if (SHAPE_SINK) { const [ax, ay] = F(0, 0); SHAPE_SINK.push({ kind: 'barrel', dx: ax, dy: ay, cxL, hl, hw, wz0: wallTop, archH, nf: NF, pal: SHAPE_PAL, base: base && base.slice ? base.slice() : base }); return; }
  if (MASS_OFF) return;   // adornments-only pass — the distance LOD draws this mass from captured segments
  const [ox, oy] = F(0, 0), [rx, ry] = F(1, 0), [fx, fy] = F(0, 1);
  const RX = rx - ox, RY = ry - oy, FX = fx - ox, FY = fy - oy, bk = cam.back || 0;   // world basis per local unit
  const P = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); };
  const shade = (s) => `rgb(${Math.min(255, base[0] * s) | 0},${Math.min(255, base[1] * s) | 0},${Math.min(255, base[2] * s) | 0})`;
  const facesCam = (nlx, nly, clx, cly) => { const NX = nlx * RX + nly * FX, NY = nlx * RY + nly * FY, [cx, cy] = F(clx, cly); return NX * cx + NY * cy + bk * (NX * cam.sinh - NY * cam.cosh) < 0; };
  const lxA = (t) => cxL + hl * Math.cos(t), zA = (t) => wallTop + archH * Math.sin(t);
  const list = [];
  const add = (pts, fill) => { if (!pts.some(p => p.f <= 0.08)) list.push({ af: pts.reduce((s, p) => s + p.f, 0) / pts.length, pts, fill }); };
  for (let k = 0; k < NF; k++) {   // barrel roof panels
    const t0 = k / NF * Math.PI, t1 = (k + 1) / NF * Math.PI, tm = (t0 + t1) / 2;
    add([P(lxA(t0), -hw, zA(t0)), P(lxA(t0), hw, zA(t0)), P(lxA(t1), hw, zA(t1)), P(lxA(t1), -hw, zA(t1))], shade(0.55 + 0.42 * Math.sin(tm)));
  }
  for (const sgn of [1, -1]) {   // arched gable tympana (apron end + back end)
    if (!facesCam(0, sgn, cxL, sgn * hw)) continue;
    const pts = [P(cxL + hl, sgn * hw, wallTop)];
    for (let k = 0; k <= NF; k++) { const t = k / NF * Math.PI; pts.push(P(lxA(t), sgn * hw, zA(t))); }
    add(pts, shade(sgn > 0 ? 0.74 : 0.5));
  }
  for (const it of list) {
    const pts = it.pts, fill = it.fill, fog = fogWeight(it.af);
    emitFace(it.af, () => {
      ctx.globalAlpha = alpha; ctx.lineJoin = 'round'; ctx.fillStyle = fill;
      ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1; ctx.stroke();   // seam between corrugated bays
      if (fog > 0.004) { ctx.globalAlpha = alpha * fog; ctx.fillStyle = FOG_STATE.css; ctx.fill(); }
      ctx.globalAlpha = 1;
    });
  }
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

// Fog a billboard's RGB toward the sky colour by its tile depth, so a distant treeline/boulder
// dissolves into the same fog wall as the ground+skyline instead of staying crisp on hazy ground.
function fogTint(col, f) { const w = fogWeight(f); return w > 0.004 ? mix(col, FOG_STATE.col, w) : col; }
function drawTreeBB(ctx, cam, dx, dy, night, seed, alpha) {
  const p = cam.proj(dx, dy, 0), s = clamp(34 / p.f, 3, 64), n = 2 + (seed % 3);
  const dark = fogTint([28, 56, 30], p.f), lit = fogTint([56, 94, 50], p.f);
  ctx.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    const ox = (frac(seed + i) - 0.5) * s * 1.1, r = s * (0.3 + frac(seed + i * 2) * 0.22), tx = p.sx + ox, ty = p.sy - r * 0.5;
    ctx.fillStyle = rgb(dark); ctx.beginPath(); ctx.ellipse(tx, ty, r, r * 0.9, 0, 0, 7); ctx.fill();
    ctx.fillStyle = rgb(lit); ctx.beginPath(); ctx.ellipse(tx - r * 0.2 * (1 - _obsHgt), ty - r * 0.3 * (1 - _obsHgt), r * (0.55 + _obsHgt * 0.4), r * (0.5 + _obsHgt * 0.4), 0, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function drawRockBB(ctx, cam, dx, dy, night, seed, alpha) {
  const p = cam.proj(dx, dy, 0), s = clamp(22 / p.f, 2, 40);
  ctx.globalAlpha = alpha; ctx.fillStyle = rgb(fogTint([120, 92, 60], p.f));
  ctx.beginPath(); ctx.moveTo(p.sx - s, p.sy); ctx.lineTo(p.sx - s * 0.3, p.sy - s * 0.7); ctx.lineTo(p.sx + s * 0.4, p.sy - s * 0.5); ctx.lineTo(p.sx + s, p.sy); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
}
// ── Arid-wildlands scatter vocabulary ─────────────────────────────────────────
// The badlands answer to the park's five dressings: a handful of cheap screen-space
// billboards (sized off the tile depth like drawRockBB, dimmed at night, fogged by distance),
// picked per-tile by the world-stable seed so a tile always shows the same thing. drawWildScatter
// dispatches by biome — rust mesa & spires over redrock, saguaro & dry brush over scrub, charred
// snags & bleached bone over the ash flats. No authoring: they self-populate the district.
function _wildBB(cam, dx, dy, k, lo, hi) { const p = cam.proj(dx, dy, 0); return p && p.f > 0.06 ? { p, s: clamp(k / p.f, lo, hi) } : null; }
function drawMesaBB(ctx, cam, dx, dy, night, seed, alpha) {   // flat-topped rust butte
  const d = _wildBB(cam, dx, dy, 26, 3, 54); if (!d) return; const { p, s } = d, nm = night ? 0.5 : 1;
  const h = s * (1.1 + frac(seed) * 0.9), w = s * (0.9 + frac(seed + 3) * 0.5), topW = w * 0.82, bx = p.sx, by = p.sy, ty = by - h;
  const lit = fogTint([168 * nm, 92 * nm, 60 * nm], p.f), shad = fogTint([104 * nm, 52 * nm, 34 * nm], p.f), band = fogTint([130 * nm, 66 * nm, 42 * nm], p.f);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rgb(shad); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + w, by); ctx.lineTo(bx + topW, ty); ctx.lineTo(bx, ty); ctx.closePath(); ctx.fill();   // shaded right face
  ctx.fillStyle = rgb(lit); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - w, by); ctx.lineTo(bx - topW, ty); ctx.lineTo(bx, ty); ctx.closePath(); ctx.fill();   // sunlit left face
  ctx.fillStyle = rgb(band);
  for (let i = 1; i <= 2; i++) { const fTop = i / 3, yy = ty + (by - ty) * fTop, hw = topW + (w - topW) * fTop; ctx.fillRect(bx - hw, yy, hw * 2, Math.max(1, s * 0.05)); }   // strata bands, inset to the silhouette
  ctx.globalAlpha = 1;
}
function drawHoodooBB(ctx, cam, dx, dy, night, seed, alpha) {   // thin capped spires
  const d = _wildBB(cam, dx, dy, 22, 2, 44); if (!d) return; const { p, s } = d, nm = night ? 0.5 : 1, n = 1 + (seed % 3);
  const body = fogTint([158 * nm, 84 * nm, 54 * nm], p.f), cap = fogTint([118 * nm, 60 * nm, 38 * nm], p.f);
  ctx.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    const ox = (frac(seed + i) - 0.5) * s * 1.4, h = s * (1 + frac(seed + i * 2) * 1.1), w = s * (0.16 + frac(seed + i * 3) * 0.1), x = p.sx + ox, by = p.sy, ty = by - h;
    ctx.fillStyle = rgb(body); ctx.beginPath(); ctx.moveTo(x - w, by); ctx.lineTo(x + w, by); ctx.lineTo(x + w * 0.6, ty); ctx.lineTo(x - w * 0.6, ty); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgb(cap); ctx.beginPath(); ctx.ellipse(x, ty, w * 1.5, w * 0.9, 0, 0, 7); ctx.fill();   // caprock knob
  }
  ctx.globalAlpha = 1;
}
function drawCactusBB(ctx, cam, dx, dy, night, seed, alpha) {   // saguaro, 0–2 arms
  const d = _wildBB(cam, dx, dy, 20, 2, 40); if (!d) return; const { p, s } = d, nm = night ? 0.55 : 1;
  const col = rgb(fogTint([66 * nm, 102 * nm, 58 * nm], p.f)), x = p.sx, by = p.sy, h = s * (1.1 + frac(seed) * 0.7), w = Math.max(1.5, s * 0.16), arms = seed % 3;
  ctx.globalAlpha = alpha; ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.fillRect(x - w / 2, by - h, w, h);
  if (arms >= 1) { const ay = by - h * 0.55; ctx.beginPath(); ctx.moveTo(x, ay); ctx.lineTo(x - w * 2.2, ay); ctx.lineTo(x - w * 2.2, ay - h * 0.3); ctx.stroke(); }
  if (arms >= 2) { const ay = by - h * 0.4; ctx.beginPath(); ctx.moveTo(x, ay); ctx.lineTo(x + w * 2, ay); ctx.lineTo(x + w * 2, ay - h * 0.34); ctx.stroke(); }
  ctx.globalAlpha = 1;
}
function drawDeadTreeBB(ctx, cam, dx, dy, night, seed, alpha) {   // charred bare snag
  const d = _wildBB(cam, dx, dy, 26, 2, 50); if (!d) return; const { p, s } = d, nm = night ? 0.5 : 1;
  const col = rgb(fogTint([46 * nm, 40 * nm, 38 * nm], p.f)), x = p.sx, by = p.sy, h = s * (1 + frac(seed) * 0.8), lean = (frac(seed) - 0.5) * s * 0.3;
  ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.4, s * 0.12); ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x + lean, by - h); ctx.stroke();
  ctx.lineWidth = Math.max(1, s * 0.06);
  const n = 2 + (seed % 3);
  for (let i = 0; i < n; i++) { const t = 0.5 + frac(seed + i) * 0.45, bx2 = x + lean * t, byy = by - h * t, dir = i % 2 ? 1 : -1; ctx.beginPath(); ctx.moveTo(bx2, byy); ctx.lineTo(bx2 + dir * s * (0.3 + frac(seed + i * 2) * 0.3), byy - s * (0.2 + frac(seed + i) * 0.3)); ctx.stroke(); }
  ctx.globalAlpha = 1;
}
function drawBonesBB(ctx, cam, dx, dy, night, seed, alpha) {   // bleached ribcage on the ground
  const d = _wildBB(cam, dx, dy, 16, 2, 30); if (!d) return; const { p, s } = d, nm = night ? 0.6 : 1;
  const col = rgb(fogTint([206 * nm, 198 * nm, 180 * nm], p.f)), x = p.sx, y = p.sy;
  ctx.globalAlpha = alpha * 0.9; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, s * 0.09);
  ctx.beginPath(); ctx.moveTo(x - s * 0.7, y); ctx.lineTo(x + s * 0.7, y); ctx.stroke();   // spine
  for (let i = 0; i < 4; i++) { const rx = x - s * 0.6 + i * s * 0.4; ctx.beginPath(); ctx.arc(rx, y - s * 0.02, s * 0.22, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); }   // ribs
  ctx.globalAlpha = 1;
}
function drawBrushBB(ctx, cam, dx, dy, night, seed, alpha) {   // dry shrub tufts
  const d = _wildBB(cam, dx, dy, 16, 2, 30); if (!d) return; const { p, s } = d, nm = night ? 0.55 : 1, n = 2 + (seed % 3);
  ctx.globalAlpha = alpha; ctx.strokeStyle = rgb(fogTint([124 * nm, 116 * nm, 72 * nm], p.f)); ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, s * 0.05);
  for (let i = 0; i < n; i++) { const bx2 = p.sx + (frac(seed + i) - 0.5) * s * 1.2, by = p.sy, spr = 3 + ((seed + i) % 3);
    for (let k = 0; k < spr; k++) { const a = -Math.PI / 2 + (k / (spr - 1) - 0.5) * 1.4, L = s * (0.35 + frac(seed + i * 3 + k) * 0.3); ctx.beginPath(); ctx.moveTo(bx2, by); ctx.lineTo(bx2 + Math.cos(a) * L, by + Math.sin(a) * L); ctx.stroke(); } }
  ctx.globalAlpha = 1;
}
function drawTumbleweedBB(ctx, cam, dx, dy, night, seed, alpha) {   // wiry tan ball
  const d = _wildBB(cam, dx, dy, 14, 2, 26); if (!d) return; const { p, s } = d, nm = night ? 0.55 : 1;
  const x = p.sx, y = p.sy - s * 0.5, r = s * 0.5;
  ctx.globalAlpha = alpha * 0.9; ctx.strokeStyle = rgb(fogTint([150 * nm, 130 * nm, 86 * nm], p.f)); ctx.lineWidth = Math.max(1, s * 0.05);
  for (let i = 0; i < 5; i++) { const a = frac(seed + i) * Math.PI; ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.stroke(); }
  ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, 7); ctx.stroke();
  ctx.globalAlpha = 1;
}
function drawWildScatter(ctx, cam, dx, dy, bi, night, seed, alpha) {
  const k = seed % 6;
  if (bi === 'redrock') {
    if (k <= 1) drawMesaBB(ctx, cam, dx, dy, night, seed, alpha);
    else if (k === 2) { drawMesaBB(ctx, cam, dx, dy, night, seed, alpha); drawHoodooBB(ctx, cam, dx, dy, night, seed + 4, alpha); }
    else if (k === 3 || k === 4) drawHoodooBB(ctx, cam, dx, dy, night, seed, alpha);
    else drawRockBB(ctx, cam, dx, dy, night, seed, alpha);
  } else if (bi === 'scrub') {
    if (k <= 1) drawCactusBB(ctx, cam, dx, dy, night, seed, alpha);
    else if (k === 2 || k === 3) drawBrushBB(ctx, cam, dx, dy, night, seed, alpha);
    else if (k === 4) drawTumbleweedBB(ctx, cam, dx, dy, night, seed, alpha);
    else drawRockBB(ctx, cam, dx, dy, night, seed, alpha);
  } else {   // ash flats
    if (k <= 1) drawDeadTreeBB(ctx, cam, dx, dy, night, seed, alpha);
    else if (k === 2) drawBonesBB(ctx, cam, dx, dy, night, seed, alpha);
    else if (k === 3) drawBrushBB(ctx, cam, dx, dy, night, seed, alpha);
    else drawRockBB(ctx, cam, dx, dy, night, seed, alpha);
  }
}
// A manicured PARK tile (flags.terrain 'park' → 'park' biome): one of five dressings — a tree
// grove, an ornamental pond, a bench-and-lamp rest spot, flowerbeds, or a paved path — instead
// of the feral single-tree parkland. `feature` (from the tile's authored `park_feature` flag)
// forces the dressing so a park can be laid out symmetrically; unset falls back to the
// world-stable tile seed, so a given tile always shows the same one.
const PARK_FEATURE = { grove: 0, pond: 1, benches: 2, flowerbeds: 3, path: 4 };
function drawParkTile(ctx, cam, dx, dy, night, seed, alpha, now, feature) {
  const p0 = cam.proj(dx, dy, 0); if (!p0 || p0.f <= 0.06) return;
  const s = clamp(30 / p0.f, 3, 58);
  const variant = (feature != null && PARK_FEATURE[feature] != null) ? PARK_FEATURE[feature] : (seed % 5);
  // A flat ground disc (on the turf, so it recedes with the Mode-7 warp). Returns quietly if
  // any point crosses the near plane.
  const disc = (rad, z, fill) => {
    const pts = [];
    for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI * 2, q = cam.proj(dx + Math.cos(a) * rad, dy + Math.sin(a) * rad, z); if (!q || q.f <= 0.06) return; pts.push(q); }
    ctx.fillStyle = fill; ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q.sx, q.sy) : ctx.moveTo(q.sx, q.sy)); ctx.closePath(); ctx.fill();
  };
  ctx.globalAlpha = alpha;
  switch (variant) {
    case 0: {   // tree grove — a fuller cluster, centred on the tile
      drawTreeBB(ctx, cam, dx, dy, night, seed, alpha);
      drawTreeBB(ctx, cam, dx, dy, night, seed + 5, alpha);
      break;
    }
    case 1: {   // ornamental pond — stone rim, water, one travelling ripple
      disc(0.34, 0.012, 'rgb(120,120,124)');
      disc(0.27, 0.016, night ? 'rgb(26,54,80)' : 'rgb(58,120,152)');
      const t = (now * 0.0005) % 1, pts = [];
      for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI * 2, rr = 0.27 * (0.3 + 0.6 * t), q = cam.proj(dx + Math.cos(a) * rr, dy + Math.sin(a) * rr, 0.02); if (!q || q.f <= 0.06) { pts.length = 0; break; } pts.push(q); }
      if (pts.length) { ctx.globalAlpha = alpha * (1 - t) * 0.5; ctx.strokeStyle = 'rgba(205,232,246,0.6)'; ctx.lineWidth = 1; ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q.sx, q.sy) : ctx.moveTo(q.sx, q.sy)); ctx.closePath(); ctx.stroke(); ctx.globalAlpha = alpha; }
      break;
    }
    case 2: {   // rest spot — a lamp post (warm at night) between two benches
      const lz = cam.proj(dx, dy, 0.16);
      if (lz && lz.f > 0.08) {
        ctx.strokeStyle = 'rgb(52,56,60)'; ctx.lineWidth = Math.max(1, s * 0.05);
        ctx.beginPath(); ctx.moveTo(p0.sx, p0.sy); ctx.lineTo(lz.sx, lz.sy); ctx.stroke();
        ctx.fillStyle = night ? 'rgba(255,214,150,0.95)' : 'rgb(214,222,150)';
        ctx.beginPath(); ctx.arc(lz.sx, lz.sy, Math.max(1.5, s * 0.09), 0, 7); ctx.fill();
      }
      ctx.fillStyle = 'rgb(96,70,44)';   // wooden benches
      for (const off of [-0.24, 0.24]) { const b = cam.proj(dx + off, dy + 0.16, 0.03); if (b && b.f > 0.08) ctx.fillRect(b.sx - s * 0.22, b.sy - s * 0.06, s * 0.44, s * 0.09); }
      if (night) glowPool(ctx, cam, dx, dy, 0.16, '255,214,150', 12, alpha * 0.3);
      break;
    }
    case 3: {   // flowerbeds — a low planted bed dotted with bright blooms
      disc(0.32, 0.011, night ? 'rgb(30,52,30)' : 'rgb(44,80,40)');
      const cols = ['rgb(214,80,90)', 'rgb(232,192,72)', 'rgb(162,92,192)', 'rgb(232,140,80)'];
      for (let i = 0; i < 7; i++) { const a = frac(seed + i * 3) * Math.PI * 2, rr = 0.1 + frac(seed + i) * 0.16, q = cam.proj(dx + Math.cos(a) * rr, dy + Math.sin(a) * rr, 0.02); if (!q || q.f <= 0.06) continue; ctx.fillStyle = cols[(seed + i) % cols.length]; ctx.beginPath(); ctx.ellipse(q.sx, q.sy, s * 0.07, s * 0.05, 0, 0, 7); ctx.fill(); }
      break;
    }
    default: {   // paved path / plaza — a pale flagstone patch + a single ornamental tree
      disc(0.3, 0.01, night ? 'rgb(94,96,100)' : 'rgb(150,150,150)');
      drawTreeBB(ctx, cam, dx + 0.26, dy + 0.22, night, seed + 3, alpha);
      break;
    }
  }
  ctx.globalAlpha = 1;
}

// ── Airport target guide ──────────────────────────────────────────────────────
// Waypoint accent: amber, the COMPLEMENT of sky-blue (the old cyan was analogous to the sky and
// vanished into the haze — see the "THE BEACH" legibility bug). Also matches the gold Home marker,
// so on-screen ring and off-screen marker now speak one colour language.
const WP_ACCENT = '255,199,64';
// A waypoint label floats over sky, cloud OR ground — any background — so it can't rely on its
// fill colour alone. This is the legibility "modifier": a dark contrast halo (stroke) under a bright
// core, the same trick the neon signs use (bakeSignText). Background-independent by construction —
// the halo carries the contrast even when the fill sits close to the colour behind it.
function haloLabel(ctx, text, x, y, font, fill) {
  ctx.font = font; ctx.lineJoin = 'round'; ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(6,10,16,0.82)'; ctx.strokeText(text, x, y);
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
}
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
    ctx.strokeStyle = `rgba(${WP_ACCENT},${0.6 + 0.4 * pulse})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, 7); ctx.stroke();
    ctx.strokeStyle = `rgba(${WP_ACCENT},${0.32 + 0.32 * pulse})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, r * 0.6, 0, 7); ctx.stroke();
    for (let a = 0; a < 4; a++) { const ang = a * Math.PI / 2; ctx.beginPath(); ctx.moveTo(p.sx + Math.cos(ang) * r, p.sy + Math.sin(ang) * r); ctx.lineTo(p.sx + Math.cos(ang) * (r + 6), p.sy + Math.sin(ang) * (r + 6)); ctx.stroke(); }
    haloLabel(ctx, (ap.name || 'FIELD').slice(0, 12).toUpperCase(), p.sx, p.sy - r - 11, 'bold 8px monospace', `rgb(${WP_ACCENT})`);
    haloLabel(ctx, ap.dist + ' mi', p.sx, p.sy - r - 3, '7px monospace', 'rgba(255,224,150,0.95)');
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
  haloLabel(ctx, (ap.name || 'FIELD').slice(0, 8).toUpperCase(), 0, -12, 'bold 7px monospace', `rgba(255,215,110,${0.78 + 0.22 * pulse})`);
  ctx.restore();
}

// ── Checkride pilot-wings rings ───────────────────────────────────────────────
// v.gates = { active, rings:[{dx,dy,altDiff,r}] } — fly-through gates for the flight
// checkride. Each ring is a billboard circle placed at its world-z (altitude delta) and
// projected through the SAME Mode-7 camera as everything else, so it grows as you close.
// The active ring glows bright green + labelled; upcoming ones are dimmer; flown ones drop.
function drawGates(ctx, cam, v, W, H, now) {
  const g = v.gates; if (!g || !Array.isArray(g.rings) || !g.rings.length) return;
  const t = (now || 0) * 0.004, pulse = 0.6 + 0.4 * Math.sin(t);
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < g.rings.length; i++) {
    if (i < g.active) continue;   // already flown
    const ring = g.rings[i];
    const wz = cam.EH + (ring.altDiff || 0) * CONTACT_ALT_K;
    const p = cam.proj(ring.dx, ring.dy, wz);
    if (p.f <= 0.12) continue;   // behind the camera
    const isActive = i === g.active;
    const rad = clamp((ring.r * 60) / p.f, 8, 260);
    const col = isActive ? '120,255,180' : '90,170,130';
    const a = isActive ? (0.55 + 0.45 * pulse) : 0.28;
    ctx.strokeStyle = `rgba(${col},${a})`; ctx.lineWidth = isActive ? 4 : 2;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, rad, 0, 7); ctx.stroke();
    ctx.strokeStyle = `rgba(${col},${a * 0.5})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, rad * 0.68, 0, 7); ctx.stroke();
    if (isActive) {
      ctx.fillStyle = `rgba(190,255,210,${0.7 + 0.3 * pulse})`; ctx.font = 'bold 8px monospace';
      ctx.fillText(`RING ${i + 1}`, p.sx, p.sy - rad - 8);
    }
  }
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
// Sizes anchored to prop = DHC-6 Twin Otter (19.8m span) at 0.11; each class set to its real
// airframe's span/rotor ratio vs that: Cessna 172 11m (0.56×), A-10/Reaper 17.5m (0.88×),
// C-130-class Leviathan ~40m (2.0×), Mini 500 rotor 5.8m (0.29×).
const CONTACT_SIZE = { ultralight: 0.056, heli: 0.032, prop: 0.11, heavy: 0.21, gunship: 0.115, wreck: 0.10, grasshopper: 0.055, locust: 0.055 };
// Own-ship EXTERNAL-chase scale: how much bigger the hero model draws than a same-class contact.
// The chase camera sits a FIXED number of tiles back (chaseBack, normalised to CONTACT_SIZE.prop),
// so lowering this shrinks the plane against the world/buildings without moving the camera — i.e. it
// fixes plane↔building scale. It is the ONE own-ext multiplier: the draw, the ground anchor
// (ownShipBaseWz/modelGroundDrop) and the gun muzzles all read it, so the gear stays pinned to the deck.
const OWN_EXT_MUL = 1.9;   // was 2.3 — dropped so the hero craft sits truer against the buildings (a Twin Otter reads ~half a tower's footprint, not level with it)
const LOD_HI_TILES = 4.5;   // contacts nearer than this (or the own chase model) render the full-detail mesh; farther ones drop to the coarse LOD (they're only a few px)

// The own-ship external-chase model's centre world-z. Two jobs, and it takes the higher of them:
//
//   • CHASE ANCHOR (`natural`) — with the craft level, the LANDING GEAR rests on the ground plane
//     (z=0, where the contact shadow lives) when parked, then climbs with the camera so the model
//     stays pinned in the chase frame as the world scrolls beneath. This is pitch/bank-INDEPENDENT
//     so the plane doesn't bob vertically as it manoeuvres at altitude.
//   • HARD FLOOR (`floor`) — the ACTUAL lowest vertex right now (with the current pitch/bank/gear
//     applied) may reach below the gear: a nose-up rotation drops the tail, a bank drops a wingtip.
//     This clamps the whole model up so NOTHING ever sinks below the ground, for every class.
//
// Both are derived straight from the shared mesh, so they can never drift from the drawn geometry.
const _groundDropCache = {};
// NB the `armed` arg: an armed heli is a DIFFERENT mesh from the unarmed one of the same
// class (the Viper vs the Dragonfly), and it ships double-size and nose-high — so measuring
// the class alone would anchor the Viper on the Dragonfly's geometry and sink it through
// the tarmac. Every cache below is therefore keyed on cls+armed, not cls.
const mdlKey = (cls, armed) => cls + (armed ? ':a' : '');
function modelGroundDrop(cls, armed) {                            // level gear drop (cached) → stable chase anchor
  const k = mdlKey(cls, armed);
  if (_groundDropCache[k] != null) return _groundDropCache[k];
  return (_groundDropCache[k] = (CONTACT_SIZE[cls] || 0.11) * OWN_EXT_MUL * CONTACT_VS * (-modelLowestH(cls, 0, 0, 1, armed)));
}
// World-z of the model's vertical CENTRE above its ground anchor, at neutral attitude (cached per class).
// Used to pin the chase framing on the model's middle, not its gear — so the same fraction of hull sits
// above/below the frame line at every zoom. Excludes the rotor disc (matches modelLowestH) so a heli
// frames on its fuselage, not its mast. Units match drawAircraftModel's vertex z (baseWz + SIZE·VS·h).
const _modelMidCache = {};
function modelMidH(cls, armed) {
  const k = mdlKey(cls, armed);
  if (_modelMidCache[k] != null) return _modelMidCache[k];
  let lo = 1e9, hi = -1e9;
  for (const face of aircraftFaces(cls, 1, !!armed)) {
    if (face.role === 'rotor') continue;
    for (const p of face.p) { if (p[2] < lo) lo = p[2]; if (p[2] > hi) hi = p[2]; }
  }
  if (lo > hi) { lo = 0; hi = 0; }
  const S = (CONTACT_SIZE[cls] || 0.11) * OWN_EXT_MUL * CONTACT_VS;
  return (_modelMidCache[k] = S * (lo + hi) / 2);
}
// The most-negative vertex height (craft units) with pitch/bank/gear applied — the model's true
// lowest point. Mirrors drawAircraftModel's own transform + gear tuck so the floor matches the pixels.
function modelLowestH(cls, pitchDeg, bankDeg, gearAnim, armed) {
  const roll = (bankDeg || 0) * Math.PI / 180, pit = (pitchDeg || 0) * Math.PI / 180;
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pit), sp = Math.sin(pit);
  const showGear = gearAnim == null ? true : gearAnim > 0.02, gearDown = gearAnim == null ? 1 : clamp(gearAnim, 0, 1);
  let m = 0;
  for (const face of aircraftFaces(cls, 1, !!armed)) {
    if (face.role === 'rotor') continue;                         // spinning disc isn't a ground contact
    if (visorHidden(face)) continue;                             // nor is a ramp stowed inside the hold — the aeroplane must not sit on furniture she keeps indoors
    const isGear = face.role === 'gear';
    if (isGear && !showGear) continue;                           // gear stowed → not a contact point
    for (const p of face.p) {
      let g = p[1], h = p[2];
      if (isGear && gearDown < 1) { g *= gearDown; h += (1 - gearDown) * 0.2; }   // tuck (matches the draw)
      const h1 = p[0] * sp + h * cp, h2 = -g * sr + h1 * cr;     // pitch then roll (up-axis component)
      if (h2 < m) m = h2;
    }
  }
  return m;
}
// Parked on (or rolling across) the Echelon's helipad, the aircraft rests on her DECK, not the
// waterline beneath it — otherwise the skids/wheels sink through the pad. We detect the deck by our
// OWN tile being her yacht cell and lift the whole ground anchor by the pad height so the gear sits
// on the pad surface. Airborne over her the constant is dwarfed by climb height, so it's a no-op in
// the air. Matches drawYacht's pad top (pZ1 × YACHT_H) and the deck-cam's DECK_PAD_Z.
// YACHT_H exaggerates the Echelon's VERTICAL scale so she reads as a big ship with real freeboard +
// superstructure height — not a flat slick that a helicopter out-tops on her own pad. It scales only
// her height (drawYacht below), NOT her fore-aft length or pad position, so the auto-land / deck-cam
// capture math (which keys off the pad at fore-aft 0.28) is untouched; only the deck SURFACE rises,
// which is why this pad-top constant tracks it.
const YACHT_H = 1.7;   // lowered from 1.9 so she rides lower / sleeker in the water (long-and-low, not tall)
// Overall size of the Echelon's 3D model — a UNIFORM shrink of her whole yacht-local frame (length,
// beam AND height), so she reads as a yacht sitting on her ~1 tile rather than a 2-tile skyscraper of
// a hull that swallows city blocks. She's drawn self-similar (shape unchanged — "keep the design"),
// just smaller. Every yacht-local constant — the hull geometry, the helipad at fore-aft 0.28, the
// catcher dome and the deck-landing capture math — is multiplied by this ONE factor so they all stay
// consistent and the heli still sets down square on the pad. KEEP IN SYNC with YACHT_SCALE in cockpit.js.
const YACHT_SCALE = 0.4;
const YACHT_DECK_Z = 0.085 * YACHT_H * YACHT_SCALE;   // parked-heli lift = the FLUSH helipad floor (pZ1 = DECKZ in drawYacht): the heli rests ON the deck
function deckLift(cam, v) {
  const c = v.map?.[cam.R]?.[cam.R];
  return c && c.mark === 'yacht' ? YACHT_DECK_Z : 0;
}
function ownShipBaseWz(cam, v) {
  const S = (CONTACT_SIZE[v.cls] || 0.11) * OWN_EXT_MUL * CONTACT_VS;
  const natural = modelGroundDrop(v.cls, !!v.armed) + (cam.EHbase - RENDER_TUNE.eh) - RENDER_TUNE.chaseSink;   // chase anchor: level gear on deck + climb
  const floor = S * (-modelLowestH(v.cls, v.pitch, v.bank, v.gearAnim ?? 1, !!v.armed)) - RENDER_TUNE.chaseSink;   // lowest actual vertex on z=0 (minus the seam trim)
  return Math.max(natural, floor) + deckLift(cam, v);   // + the Echelon's pad height when we're sitting on her deck
}
// Per-contact roll history → inferred aileron. We never get a bogey's stick input, but its
// bank angle telegraphs it: a craft changing bank is holding aileron into the roll. We track the
// last bank sample per contact id and map the roll RATE (deg/s) to a deflection, eased so it reads
// as a smooth flick when the bogey rolls rather than a per-frame twitch (bank is constant between
// the server's low-rate pushes). Elevator/flaps stay neutral (no signal for them).
const _contactRoll = new Map();   // id → { bank, ail, t }
const CONTACT_ROLL_FULL = 55;     // deg/s of bank change ⇒ full aileron
function inferContactCtrl(c, now) {
  const prev = _contactRoll.get(c.id), bank = c.bank || 0;
  let ail = 0;
  if (prev) {
    const dt = Math.min(0.3, Math.max(0, (now - prev.t) / 1000));
    const target = dt > 0.004 ? clamp((bank - prev.bank) / dt / CONTACT_ROLL_FULL, -1, 1) : prev.ail;
    ail = prev.ail + (target - prev.ail) * 0.2;   // ease toward the inferred deflection
  }
  _contactRoll.set(c.id, { bank, ail, t: now });
  return { aileron: ail, rudder: clamp(0.5 * ail, -1, 1) };   // fin kicks into the bogey's roll (coordinated turn)
}
function drawContacts(ctx, cam, v, W, H, sun, now) {
  const cs = v.contacts; if (!cs || !cs.length) return;
  ctx.save();
  const live = new Set();
  for (const c of cs) {
    if (c.id != null) { live.add(c.id); c.ctrl = inferContactCtrl(c, now); }   // ailerons deflect into the bogey's roll
    // Camera-space forward (f) / lateral-right (l) — same basis cam.proj uses.
    const f = c.dx * cam.sinh - c.dy * cam.cosh, l = c.dx * cam.cosh + c.dy * cam.sinh;
    // Altitude → world-z. Normally camera-relative (altDiff ft off our own eye-level). But a contact
    // may pin itself to an ABSOLUTE surface via `groundZ` (world-z of the deck it's landing on): then
    // its landing gear rests exactly on that surface at altDiff 0, and altDiff becomes feet ABOVE it —
    // used by the Echelon deck-cam so the helicopter's skids touch the physical helipad, not hover at
    // eye height above it.
    let baseWz;
    if (c.groundZ != null) {
      const SIZE = (CONTACT_SIZE[c.cls] || 0.11) * (c.sizeMul || 1);
      const drop = SIZE * CONTACT_VS * (-modelLowestH(c.cls, c.pitch, c.bank, 1, !!c.armed));   // gear-to-origin offset at this scale
      baseWz = c.groundZ + drop + (c.altDiff || 0) * CONTACT_ALT_K;
    } else {
      baseWz = cam.EH + (c.altDiff || 0) * CONTACT_ALT_K;
    }
    const pc = cam.proj(c.dx, c.dy, baseWz);
    const onScreen = pc.f > 0.12 && pc.sx >= -40 && pc.sx <= W + 40 && pc.sy >= -40 && pc.sy <= H + 40;
    if (!onScreen) { drawContactChevron(ctx, c, f, l, W, H); continue; }
    ctx.globalAlpha = clamp(1.5 - pc.f / 12, 0.35, 1);    // fade into the haze with distance
    const bb = drawAircraftModel(ctx, cam, c, baseWz, sun, now);
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
  for (const id of _contactRoll.keys()) if (!live.has(id)) _contactRoll.delete(id);   // drop departed bogeys
  ctx.restore();
}
// Live battle-damage break-up: a persistent break-up spec from a craft's sheared-surface map
// ({leftWing,rightWing,tail,rudder} where 0 = gone). Each lost surface's faces are drifted far
// out of the model's own frame so it simply reads as MISSING that piece — the same shed machinery
// the crash cinematic uses, but settled (not tumbling away). Shared by the cockpit's own-ship view,
// its air-contact bogeys, and the Helm chase cam. Returns null when the craft is whole. side −1 =
// left, +1 = right, null = both halves (matches shedPartFor's centreline test below).
const _SHEAR_FAR = [-4, 8, -5];   // large local-space drift → the piece leaves the visible silhouette entirely
export function surfaceBreakup(surfaces) {
  if (!surfaces) return null;
  const parts = [];
  if (surfaces.leftWing === 0)  parts.push({ roles: ['wing', 'aileron', 'flap'], side: -1,   off: _SHEAR_FAR, spin: 2.5 });
  if (surfaces.rightWing === 0) parts.push({ roles: ['wing', 'aileron', 'flap'], side: 1,    off: _SHEAR_FAR, spin: 2.5 });
  if (surfaces.tail === 0)      parts.push({ roles: ['stab', 'elevator'],        side: null, off: _SHEAR_FAR, spin: 2.5 });
  if (surfaces.rudder === 0)    parts.push({ roles: ['fin', 'rudder'],           side: null, off: _SHEAR_FAR, spin: 2.5 });
  return parts.length ? { t: 1, parts } : null;
}
// Crash break-up: which shed part (if any) a face belongs to. A part is a set of roles on
// one side of the centreline (so only the RIGHT wing or the LEFT tailplane tears off, not
// both). `side` null matches either side (the vertical fin, which straddles the centreline).
// Optional `fRange` [lo, hi) further gates on the face's fore-aft centroid (fore+), so a
// single role — the whole `body` hull — can be split into nose/mid/tail sections.
function shedPartFor(breakup, face) {
  let g = 0, f = 0; for (const v of face.p) { g += v[1]; f += v[0]; }
  const side = g >= 0 ? 1 : -1;
  const fc = f / (face.p.length || 1);
  return breakup.parts.find(pt => pt.roles.includes(face.role)
    && (pt.side == null || pt.side === side)
    && (!pt.fRange || (fc >= pt.fRange[0] && fc < pt.fRange[1]))) || null;
}
// Tumble a shed vertex: spin it about the fuselage's forward axis, then drift it out along the
// part's escape vector. Both `spin` and `off` are fed by the crash progress, so the piece
// wheels away from the wreck as it falls.
function shedVert(v, part) {
  const ca = Math.cos(part.spin), sa = Math.sin(part.spin);
  const g1 = v[1] * ca - v[2] * sa, h1 = v[1] * sa + v[2] * ca;
  return [v[0] + part.off[0], g1 + part.off[1], h1 + part.off[2]];
}
// The bogey's low-poly model, built nose-forward in ITS frame, oriented by its heading/
// bank/pitch, then every vertex projected through the shared camera. Depth-sorted filled
// faces (far first), painted in the craft's LIVERY (base/trim + finish sheen + pattern
// accents). The per-class model + livery shading come from the shared aircraft3d
// module — the same geometry the hangar spins on its turntable. Returns the screen
// bbox for the designator.
function drawAircraftModel(ctx, cam, c, baseWz, sun, now) {
  const SIZE = (CONTACT_SIZE[c.cls] || 0.11) * (c.sizeMul || 1), VS = CONTACT_VS;
  const hr = (c.hdg || 0) * Math.PI / 180, roll = (c.bank || 0) * Math.PI / 180, pitch = (c.pitch || 0) * Math.PI / 180;
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fwdX = Math.sin(hr), fwdY = -Math.cos(hr), rgtX = Math.cos(hr), rgtY = Math.sin(hr);
  const P = (lp) => {
    const f = lp[0], g = lp[1], h = lp[2];
    const f1 = f * cp - h * sp, h1 = f * sp + h * cp;               // pitch (nose up = +)
    const g2 = g * cr + h1 * sr, h2 = -g * sr + h1 * cr;            // roll (right wing down = +)
    return cam.proj(c.dx + SIZE * (f1 * fwdX + g2 * rgtX), c.dy + SIZE * (f1 * fwdY + g2 * rgtY), baseWz + SIZE * VS * h2);
  };
  // Same transform WITHOUT the projection — the vertex in world 3-space, for per-face normals.
  const Wp = (lp) => {
    const f = lp[0], g = lp[1], h = lp[2];
    const f1 = f * cp - h * sp, h1 = f * sp + h * cp;
    const g2 = g * cr + h1 * sr, h2 = -g * sr + h1 * cr;
    return [c.dx + SIZE * (f1 * fwdX + g2 * rgtX), c.dy + SIZE * (f1 * fwdY + g2 * rgtY), baseWz + SIZE * VS * h2];
  };
  // Ballistic crash debris → world vertex, DECOUPLED from the fuselage's bank/pitch. Each shed part
  // tumbles on all three axes about its OWN centroid (`part.rot`), scatters out across the ground
  // plane (`part.scatter`, in fore/right), and is placed through HEADING ONLY — so it lies flat on
  // the deck where it lands instead of riding the hull's attitude. (Non-ballistic breakup — the live
  // sheared-surface model — still uses shedVert + the fuselage transform above.)
  const Wshed = (v, part) => {
    const a = v[0] - part.cen[0], b = v[1] - part.cen[1], k = v[2] - part.cen[2];
    const rx = part.rot[0], ry = part.rot[1], rz = part.rot[2];
    let b1 = b * Math.cos(rx) - k * Math.sin(rx), k1 = b * Math.sin(rx) + k * Math.cos(rx);   // roll about fwd
    let a1 = a * Math.cos(ry) + k1 * Math.sin(ry), k2 = -a * Math.sin(ry) + k1 * Math.cos(ry); // pitch about right
    let a2 = a1 * Math.cos(rz) - b1 * Math.sin(rz), b2 = a1 * Math.sin(rz) + b1 * Math.cos(rz); // yaw about up
    const f = part.cen[0] + a2 + part.scatter[0], g = part.cen[1] + b2 + part.scatter[1], h = part.cen[2] + k2;
    return [c.dx + SIZE * (f * fwdX + g * rgtX), c.dy + SIZE * (f * fwdY + g * rgtY), baseWz + SIZE * VS * (h + (part.hop || 0))];
  };
  // Directional sun light (world-3D unit vector toward the sun) — faces pointing at it brighten,
  // faces turned away fall into shade, so the model looks genuinely lit and shifts as she banks
  // and as the sun tracks across the day. Falls back to the baked flat shading at night.
  let toSun = null, sunStr = 0;
  if (sun && sun.elev > 0.02) {
    const e = clamp(sun.elev, 0, 1), hz = Math.sqrt(Math.max(0, 1 - e * e));
    const m = Math.hypot(sun.dir[0] * hz, sun.dir[1] * hz, e) || 1;
    toSun = [sun.dir[0] * hz / m, sun.dir[1] * hz / m, e / m];
    sunStr = clamp(e * 1.4, 0, 1) * (1 - (sun.night || 0));
  }
  // Livery palette (shared with the hangar): base + trim, a finish sheen multiplier,
  // and pattern-driven accents.
  const lv = c.livery || {};
  const pal = liveryPalette(lv);
  // Jazz splatter: baked once per colour-set, affine-mapped across the hull facets in body space
  // (the same Memphis paint the hangar draws — without this the sim shows only the bone undercoat).
  const jazzImg = pal.pat === 'jazz' ? jazzTex(lv.base, lv.trim, lv.accent, lv.ground) : null;
  // Project every face; depth-sort by average forward distance (far first).
  const faces = [];
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, drawn = 0;
  // LOD: the big own-ship chase model + near contacts get the full mesh; distant contacts
  // (a few px on screen) drop to the coarse one so a crowded furball stays cheap.
  const detail = (c.sizeMul && c.sizeMul >= 1.5) || c.rng == null || c.rng <= LOD_HI_TILES ? 1 : 0;
  // Landing gear uses the SAME baked mesh the hangar/inspect draws (one model, no parallel copy):
  // the wheels/struts (role 'gear') are the class-correct geometry — the A-10's pods, the An-124's
  // centipede bogies, the Cessna tricycle. `gearAnim` (own-ship external only) retracts them by
  // tucking the legs up into the belly + folding inward while fading out; contacts (no gearAnim)
  // are airborne, so their gear is stowed (skipped). `nacelle` pods are structure — never tucked.
  const showGear = c.gearAnim > 0.02;                               // own-ship with gear not fully up; contacts (undefined) → false
  const gearDown = c.gearAnim == null ? 1 : clamp(c.gearAnim, 0, 1);
  for (const face of aircraftFaces(c.cls, detail, !!c.armed)) {
    if (face.role === 'rotor') continue;                            // spinning surfaces drawn by drawRotorFX below
    if (visorHidden(face, c.noseVisor)) continue;                   // hold + stowed ramp exist only while the cargo nose is open
    const isGear = face.role === 'gear';
    if (isGear && !showGear) continue;                              // stowed (retracted) or a contact → no gear
    // Tuck the gear legs up into the belly (+z) and fold them inward (g·ga) as gearAnim → 0.
    // Hinged control surfaces (own-ship only — `c.ctrl` set) swing about their hinge from the
    // live pilot input: ailerons roll, flaps drop, elevators pitch. Contacts pass no ctrl → neutral.
    const lp = (isGear && gearDown < 1)
      ? face.p.map(v => [v[0], v[1] * gearDown, v[2] + (1 - gearDown) * 0.2])
      : (face.visor && c.noseVisor > 0.001) ? hingeVisorFace(face, c.noseVisor)   // Leviathan cargo visor: forward section swung up when parked/cold
      : (face.hinge && c.ctrl) ? deflectSurface(face, c.ctrl)
      : face.p;
    // Crash break-up: a sheared-off part tumbles away from the wreck on its own. Ballistic pieces
    // (the crash cinematic) go through Wshed — their own tumble + scatter, decoupled from the hull;
    // live sheared surfaces use shedVert inside the fuselage transform.
    const shed = c.breakup ? shedPartFor(c.breakup, face) : null;
    const bw = (shed && shed.ballistic) ? lp.map(v => Wshed(v, shed)) : null;
    const dp = bw ? lp : (shed ? lp.map(v => shedVert(v, shed)) : lp);
    const pts = bw ? bw.map(w => cam.proj(w[0], w[1], w[2])) : dp.map(P);
    if (pts.some(q => q.f <= 0.07)) continue;                       // vertex behind the lens → skip (avoids blow-up)
    let af = 0; for (const q of pts) { af += q.f; if (q.sx < minx) minx = q.sx; if (q.sx > maxx) maxx = q.sx; if (q.sy < miny) miny = q.sy; if (q.sy > maxy) maxy = q.sy; }
    // Sun lighting multiplier: outward face normal (world) · sun. Kept ON TOP of the baked `sh`
    // so the hand-tuned character stays, but the sun now shapes the light across the airframe.
    let lm = 1;
    if (toSun && dp.length >= 3) {
      const w0 = bw ? bw[0] : Wp(dp[0]), w1 = bw ? bw[1] : Wp(dp[1]), w2 = bw ? bw[2] : Wp(dp[2]);
      const ax = w1[0] - w0[0], ay = w1[1] - w0[1], az = w1[2] - w0[2];
      const bx = w2[0] - w0[0], by = w2[1] - w0[1], bz = w2[2] - w0[2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const nm = Math.hypot(nx, ny, nz) || 1; nx /= nm; ny /= nm; nz /= nm;
      const ox = (w0[0] + w1[0] + w2[0]) / 3 - c.dx, oy = (w0[1] + w1[1] + w2[1]) / 3 - c.dy, oz = (w0[2] + w1[2] + w2[2]) / 3 - baseWz;
      if (nx * ox + ny * oy + nz * oz < 0) { nx = -nx; ny = -ny; nz = -nz; }   // outward-facing
      const nl = Math.max(0, nx * toSun[0] + ny * toSun[1] + nz * toSun[2]);
      lm = 0.82 + 0.5 * nl * sunStr;
    }
    const col = shadeRgb(faceBaseRgb(face, pal), face.sh * pal.fmul * lm);
    // Jazz UV mapped from the drawn (deflected) body coords so the splatter tracks moving surfaces.
    const uv = (jazzImg && JAZZ_ROLE.has(face.role)) ? dp.map(v => jazzUV(v, face.role)) : null;
    // Canopy art rides authored per-vertex UVs, so it survives deflection untouched (index-aligned).
    faces.push({ pts, af: af / pts.length, col, role: face.role, alpha: isGear ? gearDown : 1, uv, cuv: face.uv, cart: face.art }); drawn++;
  }
  if (!drawn) return null;
  faces.sort((a, b) => b.af - a.af);
  // Edge: hazard pattern flashes its trim; the designated target reads red; else a dark outline.
  const edge = c.designated ? 'rgba(255,90,80,0.95)' : pal.pat === 'hazard' ? shadeRgb(pal.trim, 1.0) : 'rgba(8,10,14,0.7)';
  ctx.lineJoin = 'round';
  for (const fc of faces) {
    ctx.globalAlpha = fc.alpha ?? 1;                                // gear fades as it retracts (alpha < 1)
    ctx.beginPath(); ctx.moveTo(fc.pts[0].sx, fc.pts[0].sy);
    for (let i = 1; i < fc.pts.length; i++) ctx.lineTo(fc.pts[i].sx, fc.pts[i].sy);
    ctx.closePath();
    ctx.fillStyle = fc.col; ctx.fill();
    if (fc.uv && jazzImg) overlayJazz(ctx, fc.pts, fc.uv, jazzImg);             // Memphis splatter, mapped in body space (as in the hangar)
    if (fc.cuv && detail) drawCanopyGlass(ctx, fc.pts, fc.cuv, fc.cart);        // greenhouse art — near/hero LOD only, like nose art
    if (fc.role === 'glass' || fc.role === 'window') glassSheen(ctx, fc.pts);   // glassy specular on canopy/windows, in flight too
    ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke();
    // Gloss finish: a bright specular flick on the fuselage crown.
    if (lv.finish === 'gloss' && fc.role === 'body') {
      ctx.save(); ctx.clip(); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(fc.pts[0].sx, fc.pts[0].sy); ctx.lineTo(fc.pts[1].sx, fc.pts[1].sy); ctx.stroke(); ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  // Nose art in flight — the same procedural decal the hangar paints on the forward fuselage,
  // mapped onto whichever nose side faces the camera as she banks. Only on the near/hero LOD
  // (own-ship chase + close contacts) so distant furball bogeys stay cheap. The adapter maps the
  // model-space projector P onto drawNoseArt's expected {sx,sy,z} (our depth lives in .f).
  if (detail && lv.decal && lv.decal !== 'none') {
    // Appendage faces occlude the decal so it doesn't paint through a nearer wing/nacelle/gear.
    const occ = faces.filter(fc => OCCLUDE_ROLE.has(fc.role)).map(fc => ({ P: fc.pts, z: fc.af }));
    drawNoseArt(ctx, (f, g, h) => { const q = P([f, g, h]); return { sx: q.sx, sy: q.sy, z: q.f }; }, c.cls, lv, occ);
  }
  // ── Engine effects ──────────────────────────────────────────────────────────
  // Jets trail an orange exhaust plume (growing with power); props spin a translucent disc at
  // the nose; the heli beats a faint rotor-disc blur overhead.
  const power = clamp(c.power != null ? c.power : 0.55, 0, 1), big = c.sizeMul ? 1.4 : 1;
  if (c.cls === 'gunship' || c.cls === 'heavy') {
    const np = P([1, 0, 0.02]), tp = P([-1, 0, 0.05]);
    if (np.f > 0.08 && tp.f > 0.08) {
      let ex = tp.sx - np.sx, ey = tp.sy - np.sy; const em = Math.hypot(ex, ey) || 1; ex /= em; ey /= em;
      ctx.lineCap = 'round';
      // Exhaust trails from the real nacelle exits: the A-10's twin rear pods, or the
      // An-124's four underwing turbofans out at their TRUE lateral stations (±0.34/±0.60,
      // clear of the ±0.20-wide fuselage) so a plume never sits on the belly.
      const jets = c.cls === 'heavy'
        ? [[0.02, -0.60, 0.0], [0.02, -0.34, 0.0], [0.02, 0.34, 0.0], [0.02, 0.60, 0.0]]
        : [[-0.60, -0.30, 0.16], [-0.60, 0.30, 0.16]];
      for (const st of jets) {
        const q = P(st); if (q.f <= 0.08) continue;
        // Occlusion cull (canvas has no depth buffer): an engine sitting BEHIND the fuselage
        // centreline — its projected depth farther than the hull's at this station — is hidden by
        // the hull, so skip its plume instead of painting it straight through the Leviathan.
        if (q.f > P([st[0], 0, st[2]]).f + 0.06) continue;
        const len = (7 + power * 20) * big / Math.max(0.35, q.f);
        const grad = ctx.createLinearGradient(q.sx, q.sy, q.sx + ex * len, q.sy + ey * len);
        grad.addColorStop(0, `rgba(255,225,160,${0.6 * (0.3 + power)})`); grad.addColorStop(0.5, `rgba(255,140,60,${0.4 * (0.3 + power)})`); grad.addColorStop(1, 'rgba(255,70,40,0)');
        ctx.strokeStyle = grad; ctx.lineWidth = clamp(len * 0.28, 2, 9);
        ctx.beginPath(); ctx.moveTo(q.sx, q.sy); ctx.lineTo(q.sx + ex * len, q.sy + ey * len); ctx.stroke();
      }
    }
  } else if (c.cls === 'ultralight' || c.cls === 'prop' || c.cls === 'heli') {
    // Spinning props / rotors: real model-space blades + blur disc + tip glint via
    // the shared FX layer (aircraft3d.js), projected through this SAME camera and
    // orientation so they bank and foreshorten with the craft. The own-ship (external
    // chase) passes a spool CHOREOGRAPHY — propPhase (accumulated angle, so the blades
    // slow smoothly to a stop), propSpin (blade smear, engine-on driven) and propDisc
    // (blur-disc opacity, throttle driven): the blades spin up first, THEN the disc fades
    // in; reversed on shutdown. Contacts pass none → old airspeed/power-driven look.
    const spinBase = c.propPhase != null ? c.propPhase : (now || 0) * 0.001 * (2 + power * 16);
    drawRotorFX(ctx, c.cls, (lp) => { const q = P(lp); return q.f <= 0.08 ? null : q; },
      { spin: spinBase, power: 0.15 + power * 0.85,
        disc: c.propDisc != null ? c.propDisc : null, spool: c.propSpin != null ? c.propSpin : null,
        armed: !!c.armed,   // the Viper's discs ride its double-size, nose-up transform
        bladeFade: 0.9 });   // past ~half disc, the blades melt into the blur disc (prop AND heli rotor) — full rpm reads as a pure spinning disc
  }
  ctx.globalAlpha = 1;

  // ── Nav lights + strobes ────────────────────────────────────────────────────
  // Red port / green starboard wingtips (steady), a white tail strobe, and a red belly beacon —
  // brighter at night, dim by day. A big life-giver, especially at dusk. All of it runs off the
  // engine: `lights===false` (own ship, master cut) blacks the whole set out. Contacts leave it
  // undefined → lit as before. Landing/taxi lamps (`landing`) add a bright forward set on top.
  if (c.cls !== 'wreck' && c.lights !== false) {
    const nb = clamp((sun ? sun.night : 0) * 0.7 + 0.34, 0.3, 1);
    const strobe = (now && Math.sin((now || 0) * 0.007 + (c.dx || 0) * 3) > 0.72) ? 1 : 0.1;
    const beac = 0.32 + 0.68 * Math.abs(Math.sin((now || 0) * 0.004 + (c.dy || 0)));
    // Anchor the wingtip lamps to the actual mesh wingtip station, so red/green sit ON the
    // tips (touching the wing) for every airframe instead of floating off a hand-tuned span.
    const tip = wingtipStation(c.cls);
    const lamp = (lp, col, lit) => {
      const q = P(lp); if (q.f <= 0.08 || lit <= 0.02) return;
      const s = clamp(3.2 / q.f, 1, 8) * big;
      const rg = ctx.createRadialGradient(q.sx, q.sy, 0, q.sx, q.sy, s * 2.2);
      rg.addColorStop(0, `rgba(${col},${0.85 * lit * nb})`); rg.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(q.sx, q.sy, s * 2.2, 0, 7); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.75 * lit * nb})`; ctx.beginPath(); ctx.arc(q.sx, q.sy, Math.max(0.7, s * 0.42), 0, 7); ctx.fill();
    };
    if (tip) {
      const [tf, tg, th] = tip;
      lamp([tf, -tg, th], '255,55,55', 1); lamp([tf, tg, th], '60,255,95', 1);   // port red · starboard green
      lamp([-1.0, 0, 0.14], '255,255,255', strobe); lamp([0.1, 0, -0.16], '255,90,70', beac);
    } else {
      lamp([-1.02, 0, 0.12], '255,255,255', strobe); lamp([0, 0, -0.14], '255,90,70', beac);
    }
    // Landing / taxi lights (LIGHTS switch) — a bright white pair on the wing leading edges, full-
    // bright regardless of daylight so the beam reads deliberately, with a wider soft halo than the
    // nav lamps. Only when switched on (and, being on the same engine circuit, only while lit).
    if (c.landing && tip) {
      const [tf, tg, th] = tip;
      const land = (lp) => {
        const q = P(lp); if (q.f <= 0.08) return;
        const s = clamp(3.6 / q.f, 1.2, 10) * big;
        const rg = ctx.createRadialGradient(q.sx, q.sy, 0, q.sx, q.sy, s * 3);
        rg.addColorStop(0, 'rgba(255,252,235,0.95)'); rg.addColorStop(0.5, 'rgba(255,248,220,0.38)'); rg.addColorStop(1, 'rgba(255,248,220,0)');
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(q.sx, q.sy, s * 3, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(q.sx, q.sy, Math.max(0.9, s * 0.5), 0, 7); ctx.fill();
      };
      land([tf + 0.12, -tg * 0.6, th]); land([tf + 0.12, tg * 0.6, th]);   // leading-edge lamps, inboard of the nav tips
    }
    ctx.globalAlpha = 1;
  }

  // (Landing gear is drawn inline with the model above, from the shared baked mesh — see the
  // face loop's `isGear` handling. No separate hand-drawn gear here: one model for hangar + flight.)
  // Very distant/edge-on: guarantee at least a visible pip so a far bogey never vanishes.
  if (maxx - minx < 4 && maxy - miny < 4 && !c.sizeMul) {
    ctx.fillStyle = shadeRgb(pal.base, 1.1); ctx.beginPath(); ctx.arc((minx + maxx) / 2, (miny + maxy) / 2, 2, 0, 7); ctx.fill();
  }
  return { minx, maxx, miny, maxy };
}

// Crash-cinematic pyre: a screen-space fire + smoke column drawn over the burning wreck, anchored
// to the own-ship model's screen bbox (so it tracks the tumbling/settled fuselage). Self-contained
// canvas draw (no world-object depth queue, no external art): a hot base glow, flickering flame
// tongues, and a rising, thickening, drifting column of dark smoke. `fx` = { fire, smoke, t }.
function drawWreckFire(ctx, bbox, fx, now) {
  const cx = (bbox.minx + bbox.maxx) / 2, baseY = bbox.maxy;   // bottom-centre of the wreck
  const w = Math.max(26, bbox.maxx - bbox.minx);
  const fire = clamp(fx.fire || 0, 0, 1), smoke = clamp(fx.smoke || 0, 0, 1), tm = now || 0;
  ctx.save();
  // Smoke column first (behind the flames): puffs born at the fire, rising + drifting + spreading,
  // fading in then out, lightening as they cool. Each has a stable phase so it loops smoothly.
  for (let i = 0; i < 8; i++) {
    const ph = frac(i * 0.37 + 0.11);
    const life = (tm * 0.00016 + ph) % 1;                      // 0 born at fire → 1 dissipated aloft
    const a = smoke * 0.32 * Math.sin(Math.PI * Math.min(1, life * 1.15));
    if (a <= 0.01) continue;
    const rise = life * (w * 2.6 + 70), drift = Math.sin(life * 3 + i * 1.7) * (10 + life * 30);
    const rad = w * 0.3 + life * (w * 0.55 + 20);
    const g = 40 + life * 40;                                  // darkest at the base, greying as it thins
    const px = cx + drift, py = baseY - w * 0.2 - rise;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, rad);
    grad.addColorStop(0, `rgba(${g},${g - 4},${g - 8},${a})`);
    grad.addColorStop(1, `rgba(${g},${g - 4},${g - 8},0)`);
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(px, py, rad, 0, 7); ctx.fill();
  }
  if (fire > 0.02) {
    // Hot base glow.
    const glow = ctx.createRadialGradient(cx, baseY, 0, cx, baseY, w * 0.7);
    glow.addColorStop(0, `rgba(255,190,90,${0.5 * fire})`); glow.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, baseY, w * 0.7, 0, 7); ctx.fill();
    // Flickering flame tongues rooted along the wreck's base.
    const fh = w * (0.75 + 0.55 * fire);
    for (let i = 0; i < 6; i++) {
      const fl = 0.62 + 0.38 * Math.sin(tm * 0.02 + i * 1.7);
      const ox = (frac(i * 0.29) - 0.5) * w * 0.8, tw = w * (0.14 + 0.12 * frac(i * 0.71));
      const th = fh * (0.5 + 0.5 * frac(i * 0.53)) * fl;
      const tipx = cx + ox + Math.sin(tm * 0.008 + i) * tw * 0.7;
      const grad = ctx.createLinearGradient(0, baseY, 0, baseY - th);
      grad.addColorStop(0, `rgba(255,240,180,${0.85 * fire})`);
      grad.addColorStop(0.45, `rgba(255,140,45,${0.8 * fire})`);
      grad.addColorStop(1, 'rgba(200,40,20,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.moveTo(cx + ox - tw, baseY);
      ctx.quadraticCurveTo(cx + ox - tw * 0.4, baseY - th * 0.5, tipx, baseY - th);
      ctx.quadraticCurveTo(cx + ox + tw * 0.4, baseY - th * 0.5, cx + ox + tw, baseY);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
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
// 3D gun tracers — glowing rounds that travel in WORLD space (tiles, projected through
// the flight camera) FROM a shooter's guns TOWARD where they're firing, so they streak
// out with real depth and converge on the target instead of being two flat screen lines.
// Draws the OWN ship's rounds (v.firing → toward the designated bogey, else down the
// boresight) AND any nearby CONTACT that's firing (c.firing), so you SEE other planes
// shooting near you. Called inside the banked world block, sharing drawContacts' camera.
function drawGunTracers(ctx, cam, v, now) {
  const t = (now || 0) * 0.001;
  ctx.save(); ctx.lineCap = 'round';
  // At night the rounds bloom — a warm glow around every streak + head, the same read the
  // incoming ground-AA tracers already carry so friendly and hostile fire match after dark.
  const night = v.sky?.night || 0;
  if (night > 0.3) { ctx.shadowColor = 'rgba(255,180,70,0.95)'; ctx.shadowBlur = 6 + night * 12; }
  // — Own ship: rounds leave the WING guns and converge on the designated bogey —
  if (v.firing || v.muzzle) {
    const hd = (v.heading || 0) * Math.PI / 180, sh = Math.sin(hd), ch = Math.cos(hd);
    const d = v.designated;
    let aim;
    if (d) {
      aim = [d.dx, d.dy, cam.EH + (d.altDiff || 0) * CONTACT_ALT_K];   // air target → both muzzles converge on the bogey
    } else {
      // No lock → the boresight follows the NOSE: pitch the nose down and the gun line drops toward
      // the ground ahead (converging on the ground point you're diving at → GROUND STRAFING); level
      // or nose-up and it runs out to the horizon. muzZ is the shooter's height above the ground.
      const pitchRad = (v.pitch || 0) * Math.PI / 180;
      const muzZ = v.external ? ownShipBaseWz(cam, v) : cam.EH;
      let R = 16, aimZ = muzZ + R * Math.tan(pitchRad);
      if (aimZ < 0) { R = muzZ / Math.max(0.02, -Math.tan(pitchRad)); aimZ = 0; }   // boresight meets the ground → converge there
      aim = [sh * R, -ch * R, aimZ];
    }
    let muzzles;
    if (v.external) {
      // External chase: the own ship is a MODEL at (0,0), so the guns must sit on its WINGS,
      // transformed by its heading/bank/pitch exactly like the drawn model — not "ahead of the
      // camera" (which is behind + above the plane, hence the rounds appearing over the top).
      const SIZE = (CONTACT_SIZE[v.cls] || 0.11) * OWN_EXT_MUL, baseWz = ownShipBaseWz(cam, v);
      const roll = (v.bank || 0) * Math.PI / 180, pit = (v.pitch || 0) * Math.PI / 180;
      const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pit), sp = Math.sin(pit);
      const toWorld = (f, g, hh) => { const f1 = f * cp - hh * sp, h1 = f * sp + hh * cp, g2 = g * cr + h1 * sr, h2 = -g * sr + h1 * cr;
        return [SIZE * (f1 * sh + g2 * ch), SIZE * (-f1 * ch + g2 * sh), baseWz + SIZE * CONTACT_VS * h2]; };
      // A CHIN gun (the attack heli's turret) is a single barrel slung under the NOSE, on the
      // centreline — not the fixed-wing pair out on the wings.
      muzzles = v.chinGun ? [toWorld(0.62, 0, -0.16)]
                          : [toWorld(0.34, -0.40, -0.10), toWorld(0.34, 0.40, -0.10)];
    } else {
      // Cockpit: the guns are just ahead + below the eye — dead ahead off the chin turret, or
      // off each side for the wing pair.
      muzzles = v.chinGun ? [[sh * 0.34, -ch * 0.34, cam.EH - 0.09]]
                          : [[sh * 0.34 - ch * 0.24, -ch * 0.34 - sh * 0.24, cam.EH - 0.05],
                             [sh * 0.34 + ch * 0.24, -ch * 0.34 + sh * 0.24, cam.EH - 0.05]];
    }
    muzzles.forEach((m) => {
      if (v.firing) tracerBurst(ctx, cam, m, aim, now, v.muzzleT || 0, v.gunMs || 150, v.chinGun ? 0.62 : 1);
      if (v.muzzle) muzzleFlash(ctx, cam, m[0], m[1], m[2], v.chinGun ? 0.6 : 1);
    });
  }
  // — Nearby contacts firing: rounds stream forward off each of their wings —
  if (v.contacts) for (const c of v.contacts) {
    if (!c.firing) continue;
    const id = String(c.id || ''), hash = (id.charCodeAt(0) || 0) + (id.charCodeAt(id.length - 1) || 0);   // stable per-contact phase (id is a UUID string)
    const hd = (c.hdg || 0) * Math.PI / 180, sh = Math.sin(hd), ch = Math.cos(hd);
    const wz = cam.EH + (c.altDiff || 0) * CONTACT_ALT_K;
    const aim = [c.dx + sh * 12, c.dy - ch * 12, wz];   // 12 tiles down their nose
    for (const s of [-1, 1]) {
      tracerStream(ctx, cam, [c.dx + ch * 0.24 * s, c.dy + sh * 0.24 * s, wz - 0.02], aim, t + hash * 0.11, s * 0.5 + 0.7);
      if (Math.sin(t * 30 + hash) > 0.4) muzzleFlash(ctx, cam, c.dx + ch * 0.24 * s, c.dy + sh * 0.24 * s, wz - 0.02);
    }
  }
  ctx.restore();
}
// Two-part gunsight for the external chase view. Part 1 is a FIXED centre reference — the level
// boresight (where the gun line points in level flight), which the aligned chase camera holds up the
// screen centre. Part 2 is a live PIPPER at the actual gun-convergence point projected down the nose
// (or onto the designated bogey, in red) — as you pitch/bank to aim, it drifts off the centre and the
// tie-line reads the tracking offset; pull the pipper onto the target and the rounds go there.
function drawGunReticle(ctx, cam, v, W, H, horizonY) {
  const hd = (v.heading || 0) * Math.PI / 180, sh = Math.sin(hd), ch = Math.cos(hd);
  const muzZ = ownShipBaseWz(cam, v);
  let aim, designated = false;
  if (v.designated) { aim = [v.designated.dx, v.designated.dy, cam.EH + (v.designated.altDiff || 0) * CONTACT_ALT_K]; designated = true; }
  else {
    const pr = (v.pitch || 0) * Math.PI / 180; let R = 16, az = muzZ + R * Math.tan(pr);
    if (az < 0) { R = muzZ / Math.max(0.02, -Math.tan(pr)); az = 0; }   // gun line meets the ground → converge there
    aim = [sh * R, -ch * R, az];
  }
  const pip = cam.proj(aim[0], aim[1], aim[2]);
  const ctr = cam.proj(sh * 16, -ch * 16, muzZ);                        // level boresight = the fixed centre
  const cx = ctr.f > 0.1 ? ctr.sx : W / 2, cy = ctr.f > 0.1 ? ctr.sy : horizonY;
  const green = 'rgba(120,255,150,';
  ctx.save(); ctx.lineWidth = 1.4;
  // Part 1 — fixed centre reference: a dot with four short ticks.
  ctx.strokeStyle = green + '0.85)'; ctx.fillStyle = green + '0.85)';
  ctx.beginPath(); ctx.arc(cx, cy, 2, 0, 7); ctx.fill();
  for (const [ux, uy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { ctx.beginPath(); ctx.moveTo(cx + ux * 6, cy + uy * 6); ctx.lineTo(cx + ux * 11, cy + uy * 11); ctx.stroke(); }
  // Part 2 — the tracking pipper: a ringed reticle at the gun-convergence point (red on a bogey).
  if (pip.f > 0.1) {
    const col = designated ? 'rgba(255,90,80,' : green;
    ctx.strokeStyle = green + '0.32)'; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(pip.sx, pip.sy); ctx.stroke(); ctx.setLineDash([]);   // tracking tie-line
    ctx.strokeStyle = col + '0.95)'; ctx.fillStyle = col + '0.95)';
    ctx.beginPath(); ctx.arc(pip.sx, pip.sy, 8, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(pip.sx, pip.sy, 1.6, 0, 7); ctx.fill();
    for (const a of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) { ctx.beginPath(); ctx.moveTo(pip.sx + Math.cos(a) * 8, pip.sy + Math.sin(a) * 8); ctx.lineTo(pip.sx + Math.cos(a) * 12, pip.sy + Math.sin(a) * 12); ctx.stroke(); }
  }
  ctx.restore();
}
// Own-ship tracers keyed to the ACTUAL shot times: `muzzleT` is the last round's fire time and
// `gunMs` the cadence (both from the cockpit's gun loop, same performance.now() clock as `now`),
// so one round leaves the muzzle at each shot and races to the aim over FLIGHT ms. The newest
// round is at the muzzle (f≈0) exactly when the thud plays — so rounds match the audio one-for-
// one, with no drift and no delay between the sound and the tracer.
// `sz` scales the round: the light chin gun throws a smaller, thinner tracer than the cannon.
function tracerBurst(ctx, cam, M, A, now, muzzleT, gunMs, sz = 1) {
  const FLIGHT = Math.max(150, gunMs * 1.25);   // round flight time (ms) — ~1 round on its way at a time
  const pm = cam.proj(M[0], M[1], M[2]), pa = cam.proj(A[0], A[1], A[2]);
  if (pm.f > 0.08 && pa.f > 0.08) {   // faint aiming beam so the line of fire reads between rounds
    const g = ctx.createLinearGradient(pm.sx, pm.sy, pa.sx, pa.sy);
    g.addColorStop(0, 'rgba(255,214,130,0.10)'); g.addColorStop(1, 'rgba(255,248,210,0.20)');
    ctx.strokeStyle = g; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(pm.sx, pm.sy); ctx.lineTo(pa.sx, pa.sy); ctx.stroke();
  }
  const lerp3 = (f) => [M[0] + (A[0] - M[0]) * f, M[1] + (A[1] - M[1]) * f, M[2] + (A[2] - M[2]) * f];
  for (let k = 0; k < 4; k++) {                 // the few most-recent rounds still in the air
    const age = now - (muzzleT - k * gunMs);    // ms since the k-th most-recent shot left
    if (age < 0 || age > FLIGHT) continue;
    const f0 = age / FLIGHT;                     // 0 at the muzzle → 1 at the aim
    const h = lerp3(f0), tl = lerp3(Math.max(0, f0 - 0.14));
    const ph = cam.proj(h[0], h[1], h[2]), pt = cam.proj(tl[0], tl[1], tl[2]);
    if (ph.f <= 0.1 || pt.f <= 0.1) continue;
    const rad = clamp(4.2 * sz / ph.f, 1.2, 12), al = clamp(1.5 - ph.f / 11, 0.45, 1);
    const tg = ctx.createLinearGradient(pt.sx, pt.sy, ph.sx, ph.sy);
    tg.addColorStop(0, 'rgba(255,170,60,0)'); tg.addColorStop(1, `rgba(255,250,222,${0.92 * al})`);
    ctx.strokeStyle = tg; ctx.lineWidth = rad * 1.1; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(pt.sx, pt.sy); ctx.lineTo(ph.sx, ph.sy); ctx.stroke();
    const gg = ctx.createRadialGradient(ph.sx, ph.sy, 0, ph.sx, ph.sy, rad * 2.5);
    gg.addColorStop(0, `rgba(255,252,236,${al})`); gg.addColorStop(0.45, `rgba(255,206,110,${0.68 * al})`); gg.addColorStop(1, 'rgba(255,160,50,0)');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(ph.sx, ph.sy, rad * 2.5, 0, 7); ctx.fill();
  }
}
// One glowing tracer stream from world point M=[x,y,z] to aim A=[x,y,z] (tiles), animated
// as discrete rounds racing outward. Interpolates the rounds in WORLD space so their size +
// spacing foreshorten with real perspective; each projected through the shared camera.
// (Used for NEARBY CONTACTS, whose exact shot times we don't have — own ship uses tracerBurst.)
function tracerStream(ctx, cam, M, A, phase, seed) {
  const pm = cam.proj(M[0], M[1], M[2]), pa = cam.proj(A[0], A[1], A[2]);
  // Faint continuous beam so the line of fire reads between rounds.
  if (pm.f > 0.08 && pa.f > 0.08) {
    const g = ctx.createLinearGradient(pm.sx, pm.sy, pa.sx, pa.sy);
    g.addColorStop(0, 'rgba(255,214,130,0.16)'); g.addColorStop(1, 'rgba(255,248,210,0.34)');
    ctx.strokeStyle = g; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(pm.sx, pm.sy); ctx.lineTo(pa.sx, pa.sy); ctx.stroke();
  }
  const lerp3 = (f) => [M[0] + (A[0] - M[0]) * f, M[1] + (A[1] - M[1]) * f, M[2] + (A[2] - M[2]) * f];
  for (let i = 0; i < 5; i++) {
    const f0 = (phase * 0.85 + i / 5 + frac(seed * 3.7)) % 1;   // 0 at the muzzle → 1 at the aim
    const h = lerp3(f0), tl = lerp3(Math.max(0, f0 - 0.12));
    const ph = cam.proj(h[0], h[1], h[2]), pt = cam.proj(tl[0], tl[1], tl[2]);
    if (ph.f <= 0.1 || pt.f <= 0.1) continue;
    const rad = clamp(3.8 / ph.f, 1.4, 11), al = clamp(1.5 - ph.f / 11, 0.4, 1);
    // Streak behind the round.
    const tg = ctx.createLinearGradient(pt.sx, pt.sy, ph.sx, ph.sy);
    tg.addColorStop(0, 'rgba(255,170,60,0)'); tg.addColorStop(1, `rgba(255,250,222,${0.9 * al})`);
    ctx.strokeStyle = tg; ctx.lineWidth = rad * 1.05; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(pt.sx, pt.sy); ctx.lineTo(ph.sx, ph.sy); ctx.stroke();
    // Glowing head.
    const gg = ctx.createRadialGradient(ph.sx, ph.sy, 0, ph.sx, ph.sy, rad * 2.4);
    gg.addColorStop(0, `rgba(255,252,236,${al})`); gg.addColorStop(0.45, `rgba(255,206,110,${0.65 * al})`); gg.addColorStop(1, 'rgba(255,160,50,0)');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(ph.sx, ph.sy, rad * 2.4, 0, 7); ctx.fill();
  }
}
// ── Missiles in flight ────────────────────────────────────────────────────────
// The shots the cockpit is flying (cockpit.js stepShots) drawn as REAL world objects through the
// same Mode-7 camera as the buildings and tracers — so a ripple leaves the rails and you watch it
// wander away downrange with true perspective, shrinking as it goes, instead of a decal on the
// glass. `v.missiles` = [{ dx, dy, altDiff, hdg, age, boom, trail:[[dx,dy,altDiff]…] }] (tile
// offsets from us, refreshed every frame so the shots stay anchored in the world while we move).
// Each missile is three things back-to-front: a SMOKE TRAIL (its recent path, fading with age),
// the MOTOR flare burning at its tail, and the dart itself. `boom` (0..1) replaces all of it with
// an expanding terminal burst.
function drawMissiles(ctx, cam, v, now) {
  const ms = v.missiles; if (!ms || !ms.length) return;
  ctx.save(); ctx.lineCap = 'round';
  const night = v.sky?.night || 0;
  for (const m of ms) {
    const wz = cam.EH + (m.altDiff || 0) * CONTACT_ALT_K;
    const p = cam.proj(m.dx, m.dy, wz);
    if (m.boom > 0) {
      // Terminal burst — a hot core flashing out into a dirty orange ball that fades fast.
      if (p.f <= 0.1) continue;
      const b = m.boom, r = clamp((7 + b * 34) / p.f, 3, 130), al = (1 - b) * (1 - b);
      const g = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, r);
      g.addColorStop(0, `rgba(255,250,225,${0.95 * al})`);
      g.addColorStop(0.35, `rgba(255,168,60,${0.75 * al})`);
      g.addColorStop(0.72, `rgba(190,70,25,${0.45 * al})`);
      g.addColorStop(1, 'rgba(70,50,40,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, 7); ctx.fill();
      continue;
    }
    // Smoke trail: oldest sample first, thinning and fading toward the tail. Drawn per-segment
    // so it curves through the missile's actual (weaving) path rather than a straight line.
    const tr = m.trail || [];
    for (let i = 1; i < tr.length; i++) {
      const a = cam.proj(tr[i - 1][0], tr[i - 1][1], cam.EH + tr[i - 1][2] * CONTACT_ALT_K);
      const b = cam.proj(tr[i][0], tr[i][1], cam.EH + tr[i][2] * CONTACT_ALT_K);
      if (a.f <= 0.12 || b.f <= 0.12) continue;
      const f = i / tr.length;                          // 0 = oldest wisp → 1 = at the motor
      const al = 0.30 * f * clamp(1.4 - b.f / 12, 0.25, 1);
      ctx.strokeStyle = `rgba(214,206,196,${al})`;
      ctx.lineWidth = clamp((0.9 + f * 3.2) / b.f, 0.6, 9);
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    }
    // Point-blank (the frame or two right off the rail, in the cockpit view) is skipped rather
    // than drawn — a motor a few centimetres from the eye would just white out the glass.
    if (p.f <= 0.22) continue;
    const rad = clamp(3.4 / p.f, 1.2, 14);
    // Motor flare — a bright plume out the back, flickering on the burn. Blooms at night like
    // the tracers do, so a salvo lights up the dark the way its rounds already do.
    if (night > 0.3) { ctx.shadowColor = 'rgba(255,170,80,0.95)'; ctx.shadowBlur = 6 + night * 14; }
    const flick = 0.78 + 0.22 * Math.sin(now * 0.05 + (m.age || 0) * 9);
    const fg = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, rad * 3.1 * flick);
    fg.addColorStop(0, 'rgba(255,252,238,0.95)');
    fg.addColorStop(0.4, `rgba(255,196,96,${0.7 * flick})`);
    fg.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(p.sx, p.sy, rad * 3.1 * flick, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
    // The dart — a short dark body ahead of the flare, along its own heading, so you can read
    // which way each seeker is pointed while it weaves.
    const hr = (m.hdg || 0) * Math.PI / 180;
    const nose = cam.proj(m.dx + Math.sin(hr) * 0.05, m.dy - Math.cos(hr) * 0.05, wz);
    if (nose.f > 0.1) {
      ctx.strokeStyle = 'rgba(38,40,46,0.9)'; ctx.lineWidth = clamp(2.6 / p.f, 1, 7);
      ctx.beginPath(); ctx.moveTo(p.sx, p.sy); ctx.lineTo(nose.sx, nose.sy); ctx.stroke();
    }
  }
  ctx.restore();
}

// A muzzle-flash bloom at a world-space gun station. `sz` scales it (a light gun flashes smaller).
function muzzleFlash(ctx, cam, x, y, z, sz = 1) {
  const p = cam.proj(x, y, z); if (p.f <= 0.1) return;
  const r = clamp(6 * sz / p.f, 2, 16);
  const g = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, r);
  g.addColorStop(0, 'rgba(255,244,196,0.85)'); g.addColorStop(0.5, 'rgba(255,196,90,0.5)'); g.addColorStop(1, 'rgba(255,150,40,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, 7); ctx.fill();
}

// Persistent ground AA emplacements — a radar-dish SAM turret drawn at each active site's
// tile so the thing shooting at you is a PLACE you can spot from altitude and roll in on,
// not just a bearing on the glass. Built from the same Mode-7 camera as the buildings, so it
// banks and scrolls with the world. `v.aaSites` = [{dx, dy, name}] (live tile-offset from us).
// The installation on the ground: a squat concrete BUNKER, a beefy futuristic TWIN-CANNON
// turret — an armoured housing with two heavy muzzle-braked barrels on a cruciform mount,
// TRAVERSED to track the viewing pilot (the barrels point straight at your aircraft — the
// thing shooting at you is visibly aimed at you) — and a RADAR antenna sweeping a slow circle
// beside it, topped with a pulsing red target-lock beacon that catches the eye at range.
function drawAASites(ctx, cam, v, now) {
  const sites = v.aaSites; if (!sites || !sites.length) return;
  const night = v.sky?.night || 0;
  const pulse = 0.45 + 0.55 * Math.abs(Math.sin(now / 300));   // target-lock throb (0.45..1)
  const sweep = (now / 620) % (Math.PI * 2);                   // radar antenna azimuth (rad)
  const BW = 0.2, H_BUNK = 0.09, H_RAD = 0.17;                 // bunker half-width + heights (tiles)
  const P = (s, ox, oy, wz) => cam.proj(s.dx + ox, s.dy + oy, wz);
  // Each installation is emitted as ONE atomic closure at its tile-centre depth into the shared
  // world face queue (open during the building pass) — so a building nearer than the site correctly
  // occludes the whole turret instead of it painting on top of everything (the "AA showing through a
  // building" bug, from drawing it as a post-pass after flushFaces). emitFace sorts far→near for us.
  const list = sites.map(s => ({ s, f: P(s, 0, 0, 0).f })).filter(o => o.f > 0.14 && o.f < 20);
  const corners = [[-BW, -BW], [BW, -BW], [BW, BW], [-BW, BW]];
  for (const { s, f } of list) emitFace(f, () => {
    const g = P(s, 0, 0, 0);
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // Contact shadow anchoring it to the ground.
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath(); ctx.ellipse(g.sx, g.sy, clamp(34 / f, 3, 74), clamp(12 / f, 1, 26), 0, 0, 7); ctx.fill();
    // Bunker — a squat concrete box: dark side walls then the lit top slab.
    const base = corners.map(([a, b]) => P(s, a, b, 0));
    const top = corners.map(([a, b]) => P(s, a, b, H_BUNK));
    ctx.fillStyle = '#2f2f2a';
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      ctx.beginPath(); ctx.moveTo(base[i].sx, base[i].sy); ctx.lineTo(base[j].sx, base[j].sy);
      ctx.lineTo(top[j].sx, top[j].sy); ctx.lineTo(top[i].sx, top[i].sy); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#45443d';
    ctx.beginPath(); ctx.moveTo(top[0].sx, top[0].sy); for (let i = 1; i < 4; i++) ctx.lineTo(top[i].sx, top[i].sy); ctx.closePath(); ctx.fill();
    // Bunker hatch — a dark square on the top slab (where the crew drop into the bunker).
    const h = 0.06, hatch = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([a, b]) => P(s, a, b, H_BUNK + 0.001));
    ctx.fillStyle = '#1c1c18';
    ctx.beginPath(); ctx.moveTo(hatch[0].sx, hatch[0].sy); for (let i = 1; i < 4; i++) ctx.lineTo(hatch[i].sx, hatch[i].sy); ctx.closePath(); ctx.fill();

    // Radar mast + sweeping antenna, off one corner of the bunker.
    const rx = BW * 0.78, ry = -BW * 0.55;
    const rmBot = P(s, rx, ry, H_BUNK), rmTop = P(s, rx, ry, H_RAD);
    ctx.strokeStyle = '#6b7060'; ctx.lineWidth = clamp(3 / f, 0.7, 5);
    ctx.beginPath(); ctx.moveTo(rmBot.sx, rmBot.sy); ctx.lineTo(rmTop.sx, rmTop.sy); ctx.stroke();
    const rb = 0.075, ca = Math.cos(sweep) * rb, sa = Math.sin(sweep) * rb;   // rotating bar in ground plane
    const e0 = P(s, rx + ca, ry + sa, H_RAD), e1 = P(s, rx - ca, ry - sa, H_RAD);
    ctx.strokeStyle = '#aeb69a'; ctx.lineWidth = clamp(2.4 / f, 0.6, 4);
    ctx.beginPath(); ctx.moveTo(e0.sx, e0.sy); ctx.lineTo(e1.sx, e1.sy); ctx.stroke();
    // Leading-edge sweep node — a faint blip riding the antenna tip.
    ctx.fillStyle = 'rgba(150,220,140,0.7)';
    ctx.beginPath(); ctx.arc(e0.sx, e0.sy, clamp(2.6 / f, 0.6, 4), 0, 7); ctx.fill();

    // Exposed 8.8cm flak gun on a cruciform mount, TRAVERSED to point at the viewing pilot.
    // The eye is at offset (0,0); the single long barrel lies along the ground vector from the
    // gun toward it and tilts up — the thing shooting at you is visibly aimed at you.
    const len = Math.hypot(s.dx, s.dy) || 1, ux = -s.dx / len, uy = -s.dy / len, px = -uy, py = ux;
    const zB = H_BUNK;   // gun deck (top of the bunker pad)
    // Cruciform base — four splayed outrigger legs pinning the mount to the pad, each ending
    // in a small upright foot (the ground cross that anchors the mount).
    ctx.strokeStyle = '#3a3f37'; ctx.lineWidth = clamp(5.5 / f, 1.2, 9);
    for (const [lx, ly] of [[0.22, 0], [-0.22, 0], [0, 0.22], [0, -0.22]]) {
      const c0 = P(s, 0, 0, zB), c1 = P(s, lx, ly, zB), ft = P(s, lx, ly, zB + 0.04);
      ctx.beginPath(); ctx.moveTo(c0.sx, c0.sy); ctx.lineTo(c1.sx, c1.sy); ctx.lineTo(ft.sx, ft.sy); ctx.stroke();
    }
    // Squat, fat traversing pedestal up to the turret deck.
    const zP = zB + 0.07;
    const ped0 = P(s, 0, 0, zB), ped1 = P(s, 0, 0, zP);
    ctx.strokeStyle = '#3f463d'; ctx.lineWidth = clamp(16 / f, 4, 26);
    ctx.beginPath(); ctx.moveTo(ped0.sx, ped0.sy); ctx.lineTo(ped1.sx, ped1.sy); ctx.stroke();

    // Beefy futuristic twin-cannon turret. Everything is built in the gun's own frame:
    // `ux,uy` runs along the ground toward the target (the viewing pilot), `px,py` is
    // lateral. `boxAt(a, lat, z)` projects a point `a` tiles toward the target, `lat`
    // tiles to the side, at height `z`. `drawBox` fills a rectangular prism (both lateral
    // sides + top deck + target-facing front cap, painted in that order) so each part
    // reads as solid armoured mass instead of a thin line — the girth the old 88 lacked.
    const boxAt = (a, lat, z) => P(s, ux * a + px * lat, uy * a + py * lat, z);
    const fillPoly = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(pts[0].sx, pts[0].sy); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].sx, pts[i].sy); ctx.closePath(); ctx.fill(); };
    const drawBox = (a0, z0, a1, z1, lat, hw, vt, cols) => {
      const c = (a, z, l) => boxAt(a, lat + l * hw, z);
      const T0l = c(a0, z0 + vt, -1), T0r = c(a0, z0 + vt, 1), T1l = c(a1, z1 + vt, -1), T1r = c(a1, z1 + vt, 1);
      const B1l = c(a1, z1 - vt, -1), B1r = c(a1, z1 - vt, 1);
      fillPoly([c(a0, z0 - vt, 1), c(a1, z1 - vt, 1), T1r, T0r], cols.side);   // near lateral side
      fillPoly([c(a0, z0 - vt, -1), c(a1, z1 - vt, -1), T1l, T0l], cols.side); // far lateral side
      fillPoly([T0l, T0r, T1r, T1l], cols.top);                               // top deck
      fillPoly([T1l, T1r, B1r, B1l], cols.cap);                               // front / muzzle face
    };
    // Turret body — a chunky armoured housing straddling the pedestal.
    const zBody = zP;
    drawBox(-0.14, zBody + 0.075, 0.16, zBody + 0.075, 0, 0.15, 0.075, { side: '#2b2f35', top: '#40464e', cap: '#363c44' });
    // Sensor/optics blister on the crown, a cyan lens staring down the barrels.
    drawBox(0.02, zBody + 0.17, 0.12, zBody + 0.17, 0, 0.06, 0.035, { side: '#23262b', top: '#333940', cap: '#1c1f24' });
    const lens = boxAt(0.13, 0, zBody + 0.17);
    if (night > 0.3) { ctx.shadowColor = 'rgba(60,230,230,0.9)'; ctx.shadowBlur = 6 + night * 8; }
    ctx.fillStyle = `rgba(120,245,245,${0.55 + 0.35 * pulse})`;
    ctx.beginPath(); ctx.arc(lens.sx, lens.sy, clamp(3.4 / f, 0.8, 6), 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
    // Twin heavy barrels punching out the front, elevated toward the target, each capped by
    // a fat muzzle brake with a dark bore, and a cyan charge line running along its crown.
    const BARLEN = 0.52, ELEV = 0.26, zBar = zBody + 0.09;
    const zAt = a => zBar + ELEV * clamp((a - 0.04) / (BARLEN - 0.04), 0, 1);
    for (const lat of [-0.06, 0.06]) {
      drawBox(0.04, zAt(0.04), BARLEN, zAt(BARLEN), lat, 0.032, 0.032, { side: '#3a414a', top: '#565f6b', cap: '#14171b' });
      drawBox(BARLEN - 0.14, zAt(BARLEN - 0.14), BARLEN + 0.02, zAt(BARLEN) + 0.004, lat, 0.05, 0.05, { side: '#262a30', top: '#3a414a', cap: '#101215' });
      const m = boxAt(BARLEN + 0.02, lat, zAt(BARLEN) + 0.004);   // muzzle bore
      ctx.fillStyle = '#0a0c0e'; ctx.beginPath(); ctx.arc(m.sx, m.sy, clamp(3.4 / f, 0.9, 6), 0, 7); ctx.fill();
      const g0 = boxAt(0.06, lat, zAt(0.06) + 0.033), g1 = boxAt(BARLEN - 0.16, lat, zAt(BARLEN - 0.16) + 0.033);
      if (night > 0.3) { ctx.shadowColor = 'rgba(60,230,230,0.85)'; ctx.shadowBlur = 5 + night * 7; }
      ctx.strokeStyle = `rgba(90,240,240,${0.45 + 0.4 * pulse})`; ctx.lineWidth = clamp(2 / f, 0.5, 3.4);
      ctx.beginPath(); ctx.moveTo(g0.sx, g0.sy); ctx.lineTo(g1.sx, g1.sy); ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Pulsing red target-lock beacon on the radar mast — the long-range eye-catcher.
    const bcn = P(s, rx, ry, H_RAD + 0.03), bR = clamp(7 / f, 1.5, 14) * (0.7 + 0.6 * pulse);
    if (night > 0.3) { ctx.shadowColor = 'rgba(255,40,30,0.95)'; ctx.shadowBlur = 8 + night * 12; }
    const bg = ctx.createRadialGradient(bcn.sx, bcn.sy, 0, bcn.sx, bcn.sy, bR * 2);
    bg.addColorStop(0, `rgba(255,90,70,${0.6 + 0.4 * pulse})`); bg.addColorStop(0.4, `rgba(255,40,30,${0.5 * pulse})`); bg.addColorStop(1, 'rgba(255,20,20,0)');
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(bcn.sx, bcn.sy, bR * 2, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(255,205,195,${0.8 + 0.2 * pulse})`; ctx.beginPath(); ctx.arc(bcn.sx, bcn.sy, clamp(bR * 0.5, 0.8, 5), 0, 7); ctx.fill();
    ctx.restore();
  });
}

// Incoming ground-AA volley as REAL 3D world tracers: rounds leave the emplacement's tile
// on the ground (wz 0) and climb through world space toward — and deliberately just past —
// the cockpit, projected through the same Mode-7 camera as the buildings and gun tracers.
// So the fire visibly comes from a PLACE below (the gun flashes on its tile as the volley
// leaves) instead of a direction painted on the glass. `v.aaTracer` = { dx, dy, t, seed }:
// the site's live tile-offset from us + 0..1 volley progress. Every round is aimed slightly
// wide/high of the eye — passing fire; an actual hit's feedback is the separate `air_hit`
// flash. Returns true if it drew (site projects into view); false → the caller falls back
// to the legacy screen-space streak so fire from behind still reads.
function drawAATracer3D(ctx, cam, v, now) {
  const tr = v.aaTracer;
  const M = [tr.dx, tr.dy, 0.02];   // the gun, on its tile
  if (cam.proj(M[0], M[1], M[2]).f <= 0.12) return false;   // site behind the view → 2D fallback
  const night = v.sky?.night || 0;
  ctx.save(); ctx.lineCap = 'round';
  if (night > 0.3) { ctx.shadowColor = 'rgba(255,140,50,0.95)'; ctx.shadowBlur = 6 + night * 10; }
  if (tr.t < 0.35) muzzleFlash(ctx, cam, M[0], M[1], M[2]);   // the gun flickers while the volley leaves
  const rnd = (i) => frac(Math.sin(tr.seed * 37.7 + i * 17.3) * 43758.55);
  for (let i = 0; i < 4; i++) {
    // Aim point depends on the server's hit/miss (tr.hit): a HIT walks the burst tight onto
    // the cockpit (converges on the eye, in sync with the air_hit flash); a MISS overshoots
    // the eye and sprays wide/high so it streaks past the glass. Honest either way.
    const past = tr.hit ? 0.0 : 0.12;      // miss overshoots the eye; hit terminates on it
    const spread = tr.hit ? 0.05 : 0.6;    // hit converges; miss sprays
    const A = [-tr.dx * past + (rnd(i) - 0.5) * spread, -tr.dy * past + (rnd(i + 9) - 0.5) * spread,
      cam.EH + (tr.hit ? -0.015 : 0.02) + rnd(i + 4) * (tr.hit ? 0.03 : 0.06)];
    const f0 = clamp(tr.t * 1.3 - i * 0.08, 0, 1);   // staggered rounds racing up the same line
    if (f0 <= 0 || f0 >= 1) continue;
    const lerp3 = (f) => [M[0] + (A[0] - M[0]) * f, M[1] + (A[1] - M[1]) * f, M[2] + (A[2] - M[2]) * f];
    const h = lerp3(f0), tl = lerp3(Math.max(0, f0 - 0.12));
    const ph = cam.proj(h[0], h[1], h[2]), pt = cam.proj(tl[0], tl[1], tl[2]);
    if (ph.f <= 0.08 || pt.f <= 0.08) continue;
    const rad = clamp(2.4 / ph.f, 0.7, 6), al = clamp(1.5 - ph.f / 11, 0.35, 1);
    // Streak behind the round, then the glowing head — same read as the gun tracers.
    const tg = ctx.createLinearGradient(pt.sx, pt.sy, ph.sx, ph.sy);
    tg.addColorStop(0, 'rgba(255,120,40,0)'); tg.addColorStop(1, `rgba(255,236,190,${0.9 * al})`);
    ctx.strokeStyle = tg; ctx.lineWidth = rad * 0.9; ctx.beginPath(); ctx.moveTo(pt.sx, pt.sy); ctx.lineTo(ph.sx, ph.sy); ctx.stroke();
    const gg = ctx.createRadialGradient(ph.sx, ph.sy, 0, ph.sx, ph.sy, rad * 2);
    gg.addColorStop(0, `rgba(255,250,230,${al})`); gg.addColorStop(0.5, `rgba(255,180,80,${0.55 * al})`); gg.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(ph.sx, ph.sy, rad * 2, 0, 7); ctx.fill();
  }
  ctx.restore();
  return true;
}

// Admin fireworks bursts as REAL 3D pyrotechnics, detonating at altitude over a world tile
// and projected through the same Mode-7 camera as the buildings. `v.fireworks` =
// [{ dx, dy, t, rgb, seed }] — the launch tile's live offset from us + a 0..1 life fraction.
// Each burst: a shell climbs in the first sliver of life, flowers into a sphere of sparks
// that fly out and droop under gravity, then fades. Drawn additively so overlapping sparks
// bloom. Far bursts (small on screen) still read as a coloured pop.
function drawFireworks(ctx, cam, v, now) {
  const list = v.fireworks; if (!list || !list.length) return;
  const BURST_ALT = 1.4;   // world-height of the burst centre (tiles above ground)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // Far → near so nearer bursts overpaint the ones behind.
  const shells = list.map(b => ({ b, c: cam.proj(b.dx, b.dy, BURST_ALT) }))
    .filter(o => o.c.f > 0.12 && o.c.f < 45).sort((a, z) => z.c.f - a.c.f);
  for (const { b, c } of shells) {
    const [r, g, bl] = b.rgb;
    const t = b.t;
    const rnd = (i) => frac(Math.sin(b.seed * 31.1 + i * 12.9) * 4375.85);
    // Ascent: a bright rising streak for the first 14% of life, then the burst.
    if (t < 0.14) {
      const climb = t / 0.14;
      const g0 = cam.proj(b.dx, b.dy, BURST_ALT * (0.1 + 0.9 * climb));
      const rad = clamp(3 / c.f, 0.7, 5);
      const sg = ctx.createRadialGradient(g0.sx, g0.sy, 0, g0.sx, g0.sy, rad * 2);
      sg.addColorStop(0, `rgba(255,250,235,0.9)`); sg.addColorStop(1, `rgba(${r},${g},${bl},0)`);
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(g0.sx, g0.sy, rad * 2, 0, 7); ctx.fill();
      continue;
    }
    const bt = (t - 0.14) / 0.86;           // 0..1 burst progress
    const fade = 1 - bt;
    const spread = clamp(150 / c.f, 6, 320) * (0.15 + bt * 0.95);   // sparks fly out over time
    // Central flash — brightest at detonation.
    const flashR = spread * 0.45;
    const fg = ctx.createRadialGradient(c.sx, c.sy, 0, c.sx, c.sy, flashR);
    fg.addColorStop(0, `rgba(255,255,255,${0.55 * fade})`);
    fg.addColorStop(0.4, `rgba(${r},${g},${bl},${0.45 * fade})`);
    fg.addColorStop(1, `rgba(${r},${g},${bl},0)`);
    ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(c.sx, c.sy, flashR, 0, 7); ctx.fill();
    // Radial spark shell — each spark flung out along its own angle, sagging as it ages.
    const N = 28;
    const sparkR = clamp(2.6 / c.f, 0.5, 4) * (1 - bt * 0.55);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rnd(i) * 0.22;
      const rr = spread * (0.55 + rnd(i + 7) * 0.45);
      const sx = c.sx + Math.cos(a) * rr;
      const sy = c.sy + Math.sin(a) * rr * 0.9 + bt * bt * spread * 0.4;   // gravity droop
      const al = fade * (0.65 + rnd(i + 3) * 0.35);
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sparkR * 2);
      sg.addColorStop(0, `rgba(255,250,235,${al})`);
      sg.addColorStop(0.5, `rgba(${r},${g},${bl},${al * 0.8})`);
      sg.addColorStop(1, `rgba(${r},${g},${bl},0)`);
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, sparkR * 2, 0, 7); ctx.fill();
    }
  }
  ctx.restore();
}

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
  // For the runway PAPI (glideslope lights) + windsocks drawn at each threshold below.
  const acAlt = v.landGuide?.alt ?? ((v.height || 0) ** 2 * 3000);   // aircraft altitude (ft)
  const windKt = v.wind || 0, windDeg = v.windVec?.dir ?? 250;
  const at = (rx, ry) => (ry >= 0 && ry < map.length && rx >= 0 && rx < map[ry].length) ? map[ry][rx] : null;
  const kindOf = (c) => !c ? null : c.kind === 'field' ? 'field' : c.road ? 'road' : null;   // an airfield tile paints as runway even if it also carries a road icon
  for (let ry = 0; ry < map.length; ry++) for (let rx = 0; rx < map[ry].length; rx++) {
    // …and a ROOFTOP pad (a field tile carrying a building) keeps its street: the pad is up on the roof, not painted on the block.
    const c = map[ry][rx], surf = kindOf(c); if (!surf || c.mark === 'yacht' || (surf === 'field' && c.bt)) continue;   // the yacht's own deck is drawn as a 3D model over open water — no runway concrete
    const dx = (rx - R) - cam.ox, dy = (ry - R) - cam.oy, f = dx * cam.sinh - dy * cam.cosh;
    // Near-clip per CORNER against the CAMERA. proj() clamps its returned f to 0.06, so a test on
    // proj's f is dead (never trips) — and clipping the tile CENTRE (f+back) dropped the whole tile
    // the instant its centre crossed the near plane, popping runway/road sections out from under you
    // in the 3rd-person chase. Use the true (unclamped) camera-space forward distance of each corner
    // and keep the tile while ANY corner is still ahead of the camera: a section straddling the near
    // plane just clamps its near edge off the bottom of the screen instead of vanishing. `back` folds
    // in the chase camera (which sits `back` tiles behind the craft).
    const rawF = (x, y) => (x + (cam.back || 0) * cam.sinh) * cam.sinh - (y - (cam.back || 0) * cam.cosh) * cam.cosh;
    const cf = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([a, b]) => rawF(dx + a, dy + b));
    if (cf.every(z => z <= 0.06) || f > VISIBLE_FAR_F) continue;
    // Match the buildings' long draw distance + far fade so pavement ghosts up out of the
    // haze at the horizon instead of a hard line snapping in.
    ctx.globalAlpha = baseAlpha * clamp((VISIBLE_FAR_F - f) / 6, 0, 1);
    const corner = (sx, sy) => cam.proj(dx + sx * 0.5, dy + sy * 0.5, 0);
    const P0 = corner(-1, -1), P1 = corner(1, -1), P2 = corner(1, 1), P3 = corner(-1, 1);
    // Solid fill — hard, opaque, no fade. Runway concrete reads a touch lighter than road tar.
    // A `ft:'dust'` field paints as graded dirt instead: warm ochre with a cheap per-tile jitter
    // between three close shades, so a bush strip reads patchy/scuffed rather than smooth concrete.
    const dust = c.ft === 'dust';   // graded dirt look — a lawless field strip OR a dirt_road tile
    const DUST = ['#6f5b39', '#67532f', '#786541'];
    ctx.fillStyle = dust ? DUST[(rx * 7 + ry * 13) % 3] : surf === 'field' ? '#3a3e46' : '#2b2f36';
    ctx.beginPath(); ctx.moveTo(P0.sx, P0.sy); ctx.lineTo(P1.sx, P1.sy); ctx.lineTo(P2.sx, P2.sy); ctx.lineTo(P3.sx, P3.sy); ctx.closePath(); ctx.fill();
    // Hard kerb edge: stroke each boundary that faces a non-matching surface.
    const nN = kindOf(at(rx, ry - 1)) === surf, nS = kindOf(at(rx, ry + 1)) === surf;
    const nW = kindOf(at(rx - 1, ry)) === surf, nE = kindOf(at(rx + 1, ry)) === surf;
    ctx.strokeStyle = dust ? 'rgba(150,124,74,0.55)' : surf === 'field' ? 'rgba(224,228,234,0.8)' : 'rgba(198,203,209,0.7)';
    ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    const edge = (a, b) => { ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); };
    if (!nN) edge(P0, P1); if (!nE) edge(P1, P2); if (!nS) edge(P3, P2); if (!nW) edge(P0, P3);
    // Markings. A world-space stripe from aLo→aHi along axis A at lateral offset `off`.
    const nsN = nN || nS, ewN = nW || nE;
    const DIRV = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
    const stripeA = (A, off, hw, aLo, aHi, style) => {
      const Px = A[1], Py = -A[0];
      const q = (a, o) => cam.proj(dx + A[0] * a + Px * o, dy + A[1] * a + Py * o, 0);
      const c0 = q(aLo, off - hw), c1 = q(aLo, off + hw), c2 = q(aHi, off + hw), c3 = q(aHi, off - hw);
      if ([c0, c1, c2, c3].some(p => p.f <= 0.05)) return;
      ctx.fillStyle = style; ctx.beginPath();
      ctx.moveTo(c0.sx, c0.sy); ctx.lineTo(c1.sx, c1.sy); ctx.lineTo(c2.sx, c2.sy); ctx.lineTo(c3.sx, c3.sy); ctx.closePath(); ctx.fill();
    };
    const dashedA = (A, off, hw, aLo, aHi, step, len, style) => { for (let a = aLo; a < aHi; a += step) stripeA(A, off, hw, a, Math.min(aHi, a + len), style); };
    if (dust) {
      // Graded dirt: no paint, no PAPI, no edge lights — just two worn wheel-rut tracks scuffed
      // along the run and a patchy centre drag. Reads as beaten dirt, not paved. A frontier
      // airfield STRIP (surf 'field') also stands a windsock at each open end so wind is readable;
      // a plain dirt_road lane (surf 'road') skips those — it's a track, not a runway.
      const A = (ewN && !nsN) ? [1, 0] : [0, 1];
      const RUT = 'rgba(54,42,24,0.42)', SCUFF = 'rgba(150,132,86,0.32)';
      stripeA(A, -0.13, 0.03, -0.5, 0.5, RUT); stripeA(A, 0.13, 0.03, -0.5, 0.5, RUT);      // twin wheel ruts
      dashedA(A, 0, 0.05, -0.5, 0.5, 0.4, 0.16, SCUFF);                                       // patchy centre drag
      if (surf === 'field') for (const [open, end] of [[A[0] ? nW : nN, -1], [A[0] ? nE : nS, 1]]) {
        if (open) continue;
        drawWindsock(ctx, cam, dx, dy, A, end, windKt, windDeg, now, nite);
      }
    } else if (surf === 'field') {
      const A = (ewN && !nsN) ? [1, 0] : [0, 1], WHITE = 'rgba(236,239,243,0.9)';
      dashedA(A, 0, 0.02, -0.5, 0.5, 0.34, 0.2, WHITE);                                     // dashed runway centreline
      stripeA(A, -0.42, 0.016, -0.5, 0.5, WHITE); stripeA(A, 0.42, 0.016, -0.5, 0.5, WHITE);   // runway edge lines
      // Threshold "piano keys" across each end where the runway stops (neighbour is not runway),
      // plus a PAPI glideslope array + a windsock beside that threshold.
      for (const [open, end] of [[A[0] ? nW : nN, -1], [A[0] ? nE : nS, 1]]) {
        if (open) continue;
        for (let k = -3; k <= 3; k++) stripeA(A, k * 0.11, 0.035, end * 0.5, end * 0.36, WHITE);
        drawPAPI(ctx, cam, dx, dy, A, end, acAlt, f, nite);
        drawWindsock(ctx, cam, dx, dy, A, end, windKt, windDeg, now, nite);
      }
      if (nite > 0.25) {   // glowing edge lights at night
        const Px = A[1], Py = -A[0];
        const light = (a, o) => { const p = cam.proj(dx + A[0] * a + Px * o, dy + A[1] * a + Py * o, 0); if (p.f <= 0.06) return; ctx.fillStyle = `rgba(255,246,214,${0.95 * nite})`; ctx.beginPath(); ctx.arc(p.sx, p.sy, clamp(2.2 / p.f, 0.8, 3.4), 0, 7); ctx.fill(); };
        for (const a of [-0.5, 0]) { light(a, -0.44); light(a, 0.44); }
      }
    } else {
      // Road markings driven by the piece's connections (c.rd from the map icon), so a straight,
      // a turn, a T-junction and a crossroads each read as what they are. Fall back to the
      // same-surface neighbours when a tile has no icon (a bare artery).
      const LANE = 'rgba(232,234,238,0.8)', YEL = 'rgba(230,200,74,0.9)';
      const dirs = c.rd || (nsN && ewN ? 'nesw' : (ewN && !nsN) ? 'ew' : 'ns');
      if (dirs === 'ns' || dirs === 'ew') {   // straight: continuous 4-lane markings across the tile
        const A = dirs === 'ew' ? [1, 0] : [0, 1];
        dashedA(A, -0.23, 0.014, -0.5, 0.5, 0.34, 0.2, LANE); dashedA(A, 0.23, 0.014, -0.5, 0.5, 0.34, 0.2, LANE);
        stripeA(A, -0.045, 0.014, -0.5, 0.5, YEL); stripeA(A, 0.045, 0.014, -0.5, 0.5, YEL);
      } else {   // stub / turn / T / crossroads: mark each connected arm from the centre out to its edge
        for (const d of dirs) {
          const A = DIRV[d]; if (!A) continue;
          stripeA(A, -0.045, 0.014, 0, 0.5, YEL); stripeA(A, 0.045, 0.014, 0, 0.5, YEL);              // yellow centre arm
          dashedA(A, -0.23, 0.014, 0.12, 0.5, 0.24, 0.13, LANE); dashedA(A, 0.23, 0.014, 0.12, 0.5, 0.24, 0.13, LANE);   // lane dashes, clear of the junction box
        }
      }
    }
  }
}

// PAPI — a row of four glideslope lights beside the runway threshold. Each reads WHITE when
// you're above its slope and RED when below, so the ratio tells the approach angle: 4 white =
// too high, 2/2 = on slope, 4 red = too low. Colours are driven off the aircraft's altitude
// vs. the nominal 34-ft-per-tile slope (same the landing gates use) at this threshold's range.
function drawPAPI(ctx, cam, dx, dy, A, end, acAlt, dist, nite) {
  const Px = A[1], Py = -A[0];
  const nomAlt = 34 * Math.max(0.6, dist);
  const white = clamp(Math.round(2 + ((acAlt - nomAlt) / Math.max(1, nomAlt)) / 0.16), 0, 4);
  for (let i = 0; i < 4; i++) {
    const lat = 0.56 + i * 0.075;   // beside the runway, inner (white first) → outer
    const p = cam.proj(dx + A[0] * (end * 0.4) + Px * lat, dy + A[1] * (end * 0.4) + Py * lat, 0.02);
    if (p.f <= 0.06) continue;
    const on = i < white, col = on ? '255,250,225' : '255,60,50';
    const s = clamp(2.4 / p.f, 1, 5), a = 0.6 + nite * 0.4;
    const g = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, s * 2.2);
    g.addColorStop(0, `rgba(${col},${0.9 * a})`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.sx, p.sy, s * 2.2, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${(on ? 0.9 : 0.5) * a})`; ctx.beginPath(); ctx.arc(p.sx, p.sy, Math.max(0.7, s * 0.5), 0, 7); ctx.fill();
  }
}

// Windsock — a striped fabric cone on a pole beside the threshold. It points DOWNWIND and
// inflates + lifts toward horizontal as the wind picks up (droops when calm), with a gentle
// flutter, so it reads wind direction + strength at a glance.
function drawWindsock(ctx, cam, dx, dy, A, end, windKt, windDeg, now, nite) {
  const Px = A[1], Py = -A[0];
  const wx0 = dx + A[0] * (end * 0.42) + Px * (-0.6), wy0 = dy + A[1] * (end * 0.42) + Py * (-0.6);
  const base = cam.proj(wx0, wy0, 0), top = cam.proj(wx0, wy0, 0.13);
  if (base.f <= 0.08 || top.f <= 0.08) return;
  ctx.strokeStyle = 'rgba(176,182,190,0.9)'; ctx.lineWidth = clamp(2 / top.f, 1, 3); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(base.sx, base.sy); ctx.lineTo(top.sx, top.sy); ctx.stroke();
  const strength = clamp(windKt / 22, 0.12, 1), gust = 1 + 0.12 * Math.sin((now || 0) * 0.004 + wx0);
  // windDeg is the bearing the wind blows TOWARD (matches the drift push in cockpit.js), and a
  // windsock points downwind, so the tip follows windDeg directly — no +180 flip.
  const dwr = windDeg * Math.PI / 180, dwx = Math.sin(dwr) * gust, dwy = -Math.cos(dwr) * gust;
  const len = 0.05 + strength * 0.13;
  const tip = cam.proj(wx0 + dwx * len, wy0 + dwy * len, 0.13 - (1 - strength) * 0.1);
  if (tip.f <= 0.08) return;
  let sdx = tip.sx - top.sx, sdy = tip.sy - top.sy; const sl = Math.hypot(sdx, sdy) || 1; sdx /= sl; sdy /= sl;
  const nx = -sdy, ny = sdx, mw = clamp(4.4 / top.f, 1.4, 8);
  const at = (t) => [top.sx + (tip.sx - top.sx) * t, top.sy + (tip.sy - top.sy) * t, mw * (1 - t * 0.82)];
  for (let i = 0; i < 3; i++) {
    const a0 = at(i / 3), a1 = at((i + 1) / 3);
    ctx.fillStyle = (i % 2 === 0) ? 'rgba(228,72,56,0.94)' : 'rgba(238,240,244,0.94)';
    ctx.beginPath();
    ctx.moveTo(a0[0] + nx * a0[2], a0[1] + ny * a0[2]); ctx.lineTo(a1[0] + nx * a1[2], a1[1] + ny * a1[2]);
    ctx.lineTo(a1[0] - nx * a1[2], a1[1] - ny * a1[2]); ctx.lineTo(a0[0] - nx * a0[2], a0[1] - ny * a0[2]); ctx.closePath(); ctx.fill();
  }
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

// Rooftop clutter for the otherwise-featureless flat-top boxes: a set-back mechanical
// penthouse, a couple of AC/vent units on the deck, and one seed-picked feature (water
// tank on stilts / guyed antenna mast / satellite dish) + a night aviation blink. All of
// it sits ABOVE the box's roof (`roofZ`).
//
// DELIBERATELY NOT SHAPE-CAPTURE-GUARDED. This used to be invisible to collision ("it only
// lifts the silhouette, never the hittable mass"); that is no longer true. Its boxes go
// through draw3DBoxAt, so they are captured as mass and you can now fly into a water tank.
// The price is that shape stops being a pure function of the model — `ph` varies with
// frac(seed) and the tank only exists on seed%4===0 — so the models that call this are
// flagged seedVariant by the bake and keyed by seed at runtime. The mast/dish/blink inside
// are still adornment; only the boxes count.
function roofClutter(ctx, cam, dx, dy, fh, roofZ, bi, seed, night, alpha, now) {
  const ph = roofZ * (0.14 + frac(seed) * 0.2);
  draw3DBoxAt(ctx, cam, dx + fh * 0.12, dy - fh * 0.08, fh * 0.44, roofZ, roofZ + ph, bi, seed + 7, night, alpha, true);   // set-back penthouse
  for (let i = 0; i < 2; i++) {                             // low rooftop mechanical boxes — capped (roof=true) so you don't look into an open box from above
    const ox = (frac(seed + i * 3) - 0.5) * fh, oy = (frac(seed + i * 7) - 0.5) * fh * 0.6;
    draw3DBoxAt(ctx, cam, dx + ox, dy + oy, fh * 0.15, roofZ, roofZ + roofZ * 0.07, bi, seed + 20 + i, night, alpha, true);
  }
  const r = seed % 4;
  if (r === 0) draw3DBoxAt(ctx, cam, dx - fh * 0.22, dy, fh * 0.2, roofZ + ph, roofZ + ph + roofZ * 0.16, bi, seed + 5, night, alpha, true);   // water tank on stilts (capped)
  else if (r === 1) mast(ctx, cam, dx + fh * 0.2, dy, roofZ, roofZ + roofZ * 0.55, alpha, now, seed);                                            // antenna mast
  else if (r === 2) dish(ctx, cam, dx - fh * 0.18, dy - fh * 0.1, roofZ + roofZ * 0.02, 12, alpha);                                              // satellite dish
  if (night) blinkLight(ctx, cam, dx + fh * 0.12, dy - fh * 0.08, roofZ + ph, '255,80,80', now, seed, alpha);
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
  if (kind === 1) { roofClutter(ctx, cam, dx, dy, fh, h, biome, seed, night, alpha, now); return; }   // plain mid-rise → dressed roof
  const off = kind === 3 ? fh * 0.45 : 0;                    // rooftop penthouse, corner-pushed on kind 3
  draw3DBoxAt(ctx, cam, dx + off, dy - off * 0.5, fh * 0.5, h, h + h * (0.18 + frac(seed + 2) * 0.22), biome, seed + 3, night, alpha, true);
}

// ── Per-biome adornments ──────────────────────────────────────────────────────
function drawSmoke(ctx, cam, dx, dy, wz, col, alpha, now, seed) {
  if (SHAPE_SINK || ADORN_TIER < ADORN_RICH) return;   // adornment
  const p = cam.proj(dx, dy, wz); if (p.f <= 0.12) return;
  const s = clamp(20 / p.f, 2, 40);
  emitFace(decoDepth(p.f), () => {
    for (let i = 0; i < 3; i++) {
      const t = ((now || 0) * 0.0002 + frac(seed + i)) % 1;
      ctx.fillStyle = `rgba(${col},${alpha * 0.24 * (1 - t)})`;
      ctx.beginPath(); ctx.arc(p.sx + Math.sin((now || 0) * 0.001 + i) * s * 0.4, p.sy - t * s * 2.4 - s * 0.5, s * (0.4 + t * 0.6), 0, 7); ctx.fill();
    }
  });
}
function drawGantry(ctx, cam, dx, dy, fh, h, alpha, seed) {
  const hh = h * 1.5, lw = fh * 1.4;
  const a = cam.proj(dx - lw, dy, 0), at = cam.proj(dx - lw, dy, hh), b = cam.proj(dx + lw, dy, 0), bt = cam.proj(dx + lw, dy, hh);
  if ([a, at, b, bt].some(p => p.f <= 0.12)) return;
  const jib = cam.proj(dx + lw * 2.1, dy, hh * 0.9);
  emitFace(decoDepth(a.f, at.f, b.f, bt.f), () => {
    ctx.globalAlpha = alpha; ctx.strokeStyle = 'rgba(126,116,96,0.85)'; ctx.lineWidth = 1.4; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(at.sx, at.sy); ctx.lineTo(bt.sx, bt.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    if (jib.f > 0.12) { ctx.beginPath(); ctx.moveTo(at.sx, at.sy); ctx.lineTo(jib.sx, jib.sy); ctx.stroke(); }
    ctx.globalAlpha = 1;
  });
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
  } else {   // low sprawling plant hall + rooftop vents/tank so it isn't a bare slab
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.25, 0, h * 0.8, bi, seed, night, alpha, true);
    roofClutter(ctx, cam, dx, dy, fh * 1.25, h * 0.8, bi, seed, night, alpha, now);
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
  } else {   // long low warehouse + rooftop HVAC/vents so it isn't a bare slab
    const rz = h * (kind === 0 ? 0.5 : 0.62);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.4, 0, rz, bi, seed, night, alpha, true);
    roofClutter(ctx, cam, dx, dy, fh * 1.4, rz, bi, seed, night, alpha, now);
    if (bi === 'docks') drawGantry(ctx, cam, dx, dy, fh, h, alpha, seed);
  }
}
function drawRuin(ctx, cam, dx, dy, fh, h, bi, seed, night, alpha, now) {
  draw3DBoxAt(ctx, cam, dx, dy, fh, 0, h * (0.5 + frac(seed) * 0.45), bi, seed, night, alpha, true);   // half-standing shell
  if ((seed % 2) === 0) draw3DBoxAt(ctx, cam, dx + fh * 0.95, dy, fh * 0.55, 0, h * (0.2 + frac(seed + 1) * 0.3), bi, seed + 4, night, alpha, true);   // broken remnant
  if (bi === 'ruins') {   // Redline radioactive glow
    const g = cam.proj(dx, dy, h * 0.3);
    if (g.f > 0.12) emitFace(decoDepth(g.f), () => { const s = clamp(24 / g.f, 3, 50), rg = ctx.createRadialGradient(g.sx, g.sy, 1, g.sx, g.sy, s); rg.addColorStop(0, `rgba(150,220,80,${alpha * 0.22})`); rg.addColorStop(1, 'rgba(150,220,80,0)'); ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(g.sx, g.sy, s, 0, 7); ctx.fill(); });
  }
}
function drawMarquee(ctx, cam, dx, dy, fh, h, bi, seed, night, alpha, now) {
  draw3DBoxAt(ctx, cam, dx, dy, fh, 0, h * 0.7, bi, seed, night, alpha, true);
  const b = cam.proj(dx, dy, h * 0.7), t = cam.proj(dx, dy, h * 1.05);   // rooftop neon sign
  if (b.f > 0.12 && t.f > 0.12) emitFace((b.f + t.f) / 2, () => {
    const neon = ['#ff4a9a', '#5fd0ff', '#ffcf3e', '#7dff6a'][seed % 4];
    ctx.globalAlpha = alpha * (night ? 0.95 : 0.5); ctx.strokeStyle = neon; ctx.lineWidth = 2.2;
    if (night) { ctx.shadowColor = neon; ctx.shadowBlur = 6; }
    ctx.beginPath(); ctx.moveTo(b.sx, b.sy); ctx.lineTo(t.sx, t.sy); ctx.stroke(); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  });
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
  halcyontowers:                  { type: 'luxtower',  pal: 'ty_halcyon',  neon: '#39f0ff' },
  embassyhotelbar:                { type: 'embassy',   pal: 'ty_embassy',  neon: '#ff4a9a' },
  chromecourt:                    { type: 'chrome',    pal: 'ty_chrome' },
  themeridianlobby:               { type: 'meridian',  pal: 'ty_meridian', penthouse: true },
  precinct9:                      { type: 'police',    pal: 'ty_police' },
  hallofrecords:                  { type: 'archive',   pal: 'ty_archive' },
  coldwaterclonefacility:         { type: 'clone',     pal: 'ty_clone' },
  ksabtvstudiostage:              { type: 'ksabstudio', pal: 'ty_ksab', neon: '#b98cff' },
  ksabwriterswing:                { type: 'studiogate', pal: 'ty_ksab', neon: '#b98cff' },
  thegreenroom:                    { type: 'divebar',   pal: 'ty_greenroom', neon: '#7dff6a' },
  solenneresidences:              { type: 'solenne',   pal: 'ty_solenne',   neon: '#ffce78' },
  coldwatersentinel:              { type: 'sentinel',  pal: 'ty_sentinel',  neon: '#5fd0ff' },   // was a recoloured corporate tower; it's a two-storey storefront newsroom
  // These two were keyed to names the buildings no longer have — a rename silently
  // dropped them back to the generic shop/office mesh, because namedModel() misses and
  // TYPE_MODEL catches. Re-keyed to the live building_name and given real silhouettes.
  // ('meltwaterdiner' and 'thecage' were dead the same way, but match NO building in
  // content or the DB, so they were removed rather than re-pointed.)
  batteryacidcoffeeco:            { type: 'stimcafe',  pal: 'ty_jitter',    neon: '#5fd0ff' },   // was `jitter`
  officeofpermittedsuffering:     { type: 'permits',   pal: 'ty_ward',      neon: '#9ab08a' },   // was `wardninepermits`
  copaypray:          { type: 'clinic',    pal: 'ty_clinic' },
  inhockwetrust:                    { type: 'pawn',      pal: 'ty_pawn',      neon: '#ffcf3e' },
  coldwaterpowerplantturbinehall: { type: 'power',     pal: 'ty_power' },
  coldwaterregionalhangar:        { type: 'hangar',    pal: 'ty_hangar_a', big: true },
  thresholdhelipadhangar:         { type: 'hangar',    pal: 'ty_hangar_b', helipad: true },
  sump:                           { type: 'divebar',   pal: 'ty_bar_a',    neon: '#7dff6a' },
  thedeadpigeon:                  { type: 'divebar',   pal: 'ty_bar_b',    neon: '#5fd0ff', perch: true },
  thecherrypit:                   { type: 'strip',     pal: 'ty_club',     neon: '#ff4a9a' },
  rationnine:                     { type: 'rationnine', pal: 'ty_ration',  neon: '#ffb43a' },
  ohmsweetohm:           { type: 'techstall', pal: 'ty_tech',     neon: '#5fd0ff' },
  deadspaceinteriors:             { type: 'showroom',  pal: 'ty_showroom', neon: '#7dff6a' },
  secondskin:                     { type: 'boutique',  pal: 'ty_boutique', neon: '#ff4a9a' },
  velkspreownedfurnishings:       { type: 'junkshop',  pal: 'ty_junk',     neon: '#ff8a4a' },
  voltage:                        { type: 'nightclub', pal: 'ty_voltage',  neon: '#5cd6ff' },
  aurelia:                        { type: 'atelier',   pal: 'ty_aurelia',  neon: '#b070ff' },
  halloransfixit:                 { type: 'garage',    pal: 'ty_garage',   neon: '#ffb14a' },
  // The Reach — four hand-built frontier landmarks. Grim-dark meets wild-west; each is a one-off
  // silhouette so the tiny outpost reads as unforgettable from the air (docs/reference/world-rendering.md).
  // ── Yards twins: the distinguished half of each same-type pair ──────────────
  // Each of these shared a TYPE_MODEL with a neighbour of the same building_type and
  // was indistinguishable from it in the air. The twin keeps the generic type model;
  // this one gets a silhouette you can name from a mile out.
  chilloutlogistics:            { type: 'reefer',     pal: 'ty_reefer_blk' },
  stackoverflow:               { type: 'interstack', pal: 'ty_stack_dk' },
  weldenoughalone:          { type: 'foundry',    pal: 'ty_foundry' },
  yardsfreightoffice:         { type: 'oldoffice',  pal: 'ty_meltoffice', neon: '#ffb43a' },
  bondedbothered:            { type: 'bonded',     pal: 'ty_wh_metal',   neon: '#6affa8' },
  // Promoted off the generic `casino` type model so a future casino still has one.
  theneonvig:                     { type: 'neonvig',    pal: 'ty_vig',        neon: '#ff3e8a' },
  buzzardfield:                   { type: 'buzzard',   pal: 'ty_reach_hangar', neon: '#ffb14a' },
  thecoyotesrest:                 { type: 'saloon',    pal: 'ty_reach_saloon', neon: '#ff6a3a' },
  thedynamo:                      { type: 'dynamo',    pal: 'ty_reach_dynamo', neon: '#6cf0ff' },
  thelayover:                     { type: 'layover',   pal: 'ty_reach_motel',  neon: '#ff5a86' },
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
  nightclub:        { type: 'nightclub', pal: 'ty_voltage', neon: '#5cd6ff' },
  boutique:         { type: 'boutique',  pal: 'ty_boutique', neon: '#ff4a9a' },
  studio:           { type: 'studio',    pal: 'ty_studio' },
  police:           { type: 'police',    pal: 'ty_police' },
  clinic:           { type: 'clinic',    pal: 'ty_clinic' },
  power:            { type: 'power',     pal: 'ty_power' },
  hangar:           { type: 'hangar',    pal: 'ty_hangar_a' },
  gun_shop:         { type: 'armory',    pal: 'ty_armory', neon: '#ff6a4a' },
  casino:           { type: 'casino',    pal: 'ty_casino', neon: '#ff3e8a' },
  fence:            { type: 'pawn',      pal: 'ty_pawn',   neon: '#ffcf3e' },
  chem_supply:      { type: 'chemsupply', pal: 'ty_chem',  neon: '#7dff6a' },
  // Reuses the shop mesh with its own iron-toned palette + warm sign, the same
  // "nearest existing model, bespoke colour" call the Ascendant campus makes.
  kitchenware:      { type: 'shop',      pal: 'ty_kitchen', neon: '#ff9a3e' },
  bank:             { type: 'bank',      pal: 'ty_marble' },
  // The Yards — semi-industrial freight district (see docs/proposals/yards.md).
  warehouse:         { type: 'warehouse',         pal: 'ty_wh_metal' },
  container_yard:    { type: 'container_yard',    pal: 'ty_cont_b' },
  fuel_yard:         { type: 'fuel_yard',         pal: 'ty_pallet' },
  cold_storage:      { type: 'cold_storage',      pal: 'ty_cold' },
  fabrication:       { type: 'fabrication',       pal: 'ty_fab_metal' },
  wharf:             { type: 'wharf',             pal: 'ty_wharf' },
  freight_office:    { type: 'freight_office',    pal: 'ty_freight_office', neon: '#ffb43a' },
  freight_forwarder: { type: 'freight_forwarder', pal: 'ty_fwd_metal' },
  // The scrapyard on the wasteland edge — crushed-car bales, a grabber crane, a shack.
  junkyard:          { type: 'junkyard',          pal: 'ty_junk_shack', neon: '#ffb43a' },
  // The only warm-lit window on Ironside — a wide glazed front and a cold-blue sign.
  laundromat:        { type: 'laundromat',        pal: 'ty_asc_clinic', neon: '#7fe3ff' },
  // Marrow Street — the workaday downtown strip either side of the Sentinel. Each type
  // has exactly one building and each gets its OWN silhouette, not a recoloured shop box:
  // the strip has to read as a high street from the air, which it can't do if four of the
  // six are the same mesh.
  dept_store:        { type: 'deptstore',         pal: 'ty_adequate',   neon: '#ff8a2e' },
  hardware:          { type: 'hardware',          pal: 'ty_bolt',       neon: '#ffcf3e' },
  bathhouse:         { type: 'bathhouse',         pal: 'ty_soak',       neon: '#7fe3c0' },
  noodle_bar:        { type: 'noodlebar',         pal: 'ty_broth',      neon: '#ff5a3e' },
  outfitter:         { type: 'outfitter',         pal: 'ty_secondskin', neon: '#ffb43a' },
  bodega:            { type: 'bodega',            pal: 'ty_kessel',     neon: '#ffe08a' },
  // The Ascendant Stronghold (docs/proposals/ascendant-stronghold.md).
  asc_spire:  { type: 'asc_spire',  pal: 'ty_asc_spire' },
  asc_gate:   { type: 'asc_gate',   pal: 'ty_asc_gate' },
  asc_clinic: { type: 'asc_clinic', pal: 'ty_asc_clinic' },
  asc_weave:  { type: 'asc_weave',  pal: 'ty_asc_weave' },
  asc_vats:   { type: 'asc_vats',   pal: 'ty_asc_vats' },
  asc_shrine: { type: 'asc_shrine', pal: 'ty_asc_shrine' },
};
function modelFor(cell) { return (cell.bn && namedModel(cell.bn)) || (cell.bt && TYPE_MODEL[cell.bt]) || null; }

// Every model the world can resolve, as {key, m} — the key space the shape bake enumerates and the
// shape lint checks for coverage. Named models are prefixed so a building called "Hangar" can never
// collide with the `hangar` building_type. The `m` values are the same object identities modelFor
// hands back, which is what lets shapeForModel cache on them.
export function shapeModelRegistry() {
  return [
    ...Object.entries(NAMED_MODELS).map(([k, m]) => ({ key: `named:${k}`, m })),
    ...Object.entries(TYPE_MODEL).map(([k, m]) => ({ key: `type:${k}`, m })),
  ];
}
// The bake's two correctness gates, re-exported so the script doesn't reach into module internals.
export { shapeLinearityError, shapeIsSeedVariant };

// PAINT SMOKE TEST. Capture returns early out of every mass primitive, so it proves a model's
// GEOMETRY is sane but never executes the drawing. That gap is not theoretical: the Battery Acid
// roaster passed a palette KEY where drawFacetDrum wanted a style FUNCTION, and because the only
// thing that ever runs these 72 arms is a human flying past one, it sat there until it threw
// "style is not a function" mid-frame and froze the sim.
//
// So: render every model for real against the stub ctx — including flushFaces(), since most of the
// actual ctx work lives in deferred closures — across night/day and both entrance facings, and
// report anything that throws. Runs in node under a DOM stub; see scripts/shapes/.
export function shapeRenderSmoke() {
  const out = [];
  for (const { key, m } of shapeModelRegistry()) {
    for (const night of [0, 0.9]) for (const dyOff of [-8, 8]) {
      const savedFace = FACE_SINK, savedFog = FOG_STATE, savedLight = LIGHT_STATE, savedSign = _bladeSign;
      try {
        FACE_SINK = [];
        drawTypeModel(SHAPE_STUB_CTX, SHAPE_STUB_CAM, 0, dyOff, 0.4, 1, m, 3, night, 1, 1000, [0, 1], 'SMOKE TEST');
        flushFaces();   // the closures are where nearly all the ctx calls actually happen
      } catch (e) {
        out.push({ key, night, front: dyOff < 0, err: e.message });
      } finally {
        FACE_SINK = savedFace; FOG_STATE = savedFog; LIGHT_STATE = savedLight; _bladeSign = savedSign;
      }
    }
    // The adornments-only pass is a THIRD way an arm can run (mass suppressed, lights drawn), and an
    // arm that reads back something a mass primitive would have returned would only fail here.
    for (const night of [0, 0.9]) {
      const savedFace = FACE_SINK, savedFog = FOG_STATE, savedLight = LIGHT_STATE, savedSign = _bladeSign;
      try {
        FACE_SINK = []; MASS_OFF = true;
        drawTypeModel(SHAPE_STUB_CTX, SHAPE_STUB_CAM, 0, -8, 0.4, 1, m, 3, night, 1, 1000, [0, 1], 'SMOKE TEST');
        flushFaces();
      } catch (e) {
        out.push({ key, night, err: `adornments-only: ${e.message}` });
      } finally {
        MASS_OFF = false; FACE_SINK = savedFace; FOG_STATE = savedFog; LIGHT_STATE = savedLight; _bladeSign = savedSign;
      }
    }
    // The LOD path is a second renderer for the same 83 models and needs the same coverage — it has
    // its own rotation, its own drum shading and its own roof approximations, any of which can throw
    // on a model nobody flew past. Swept across the detail range and all four entrance facings,
    // since the entrance vector feeds the yaw term.
    for (const detail of [1, 0.6, 0.2, 0]) for (const E of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const savedFace = FACE_SINK, savedFog = FOG_STATE, savedLight = LIGHT_STATE;
      try {
        FACE_SINK = [];
        drawModelLOD(SHAPE_STUB_CTX, SHAPE_STUB_CAM, 0, -8, 0.4, 1, m, 3, 0.5, 1, E, detail);
        flushFaces();
      } catch (e) {
        out.push({ key, detail, E: E.join(','), err: `LOD: ${e.message}` });
      } finally {
        FACE_SINK = savedFace; FOG_STATE = savedFog; LIGHT_STATE = savedLight;
      }
    }
  }
  return out;
}

// Shared adornment primitives for the dedicated models (all project through the same camera).
function blinkLight(ctx, cam, dx, dy, wz, rgb, now, seed, alpha, r = 1.6) {
  if (SHAPE_SINK || ADORN_TIER < ADORN_CHEAP) return;   // adornment
  const p = cam.proj(dx, dy, wz); if (p.f <= 0.1) return;
  const k = 0.4 + 0.5 * Math.abs(Math.sin((now || 0) * 0.004 + seed));
  emitFace(decoDepth(p.f), () => { ctx.globalAlpha = alpha; ctx.fillStyle = `rgba(${rgb},${k})`; ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, 7); ctx.fill(); ctx.globalAlpha = 1; });
}
function mast(ctx, cam, dx, dy, h0, h1, alpha, now, seed) {   // guyed antenna mast + red aviation light
  if (SHAPE_SINK || ADORN_TIER < ADORN_CHEAP) return;   // adornment — you don't CFIT into an antenna
  const a = cam.proj(dx, dy, h0), b = cam.proj(dx, dy, h1);
  if (a.f > 0.1 && b.f > 0.1) emitFace(decoDepth(a.f, b.f), () => { ctx.globalAlpha = alpha; ctx.strokeStyle = 'rgba(184,192,206,0.8)'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); ctx.globalAlpha = 1; });
  blinkLight(ctx, cam, dx, dy, h1, '255,80,80', now, seed, alpha);
}
function dish(ctx, cam, dx, dy, wz, s0, alpha) {   // rooftop satellite dish
  if (SHAPE_SINK || ADORN_TIER < ADORN_CHEAP) return;   // adornment
  const p = cam.proj(dx, dy, wz); if (p.f <= 0.1) return; const r = clamp(s0 / p.f, 2, 22);
  emitFace(decoDepth(p.f), () => { ctx.globalAlpha = alpha; ctx.fillStyle = 'rgba(198,204,214,0.85)'; ctx.beginPath(); ctx.ellipse(p.sx, p.sy, r, r * 0.5, -0.5, 0, 7); ctx.fill(); ctx.globalAlpha = 1; });
}
function crossMark(ctx, cam, dx, dy, wz, alpha) {   // red medical cross billboard
  if (SHAPE_SINK || ADORN_TIER < ADORN_CHEAP) return;   // adornment
  const p = cam.proj(dx, dy, wz); if (p.f <= 0.1) return; const s = clamp(9 / p.f, 2, 16);
  emitFace(decoDepth(p.f), () => { ctx.globalAlpha = alpha; ctx.fillStyle = 'rgba(230,60,60,0.95)'; ctx.fillRect(p.sx - s * 0.28, p.sy - s, s * 0.56, s * 2); ctx.fillRect(p.sx - s, p.sy - s * 0.28, s * 2, s * 0.56); ctx.globalAlpha = 1; });
}
// ── The Reach — frontier adornments ───────────────────────────────────────────
// A slow-turning multi-blade WIND WHEEL (the Dynamo's windmill / genset flywheel) facing the
// camera at world (dx,dy,z); worldR sets screen size off depth. Rotates on `now`. Wrapped as a
// rooftop deco so it sits over its own mast without punching through nearer geometry.
function windWheel(ctx, cam, dx, dy, z, worldR, now, alpha, seed = 0) {
  if (SHAPE_SINK || ADORN_TIER < ADORN_RICH) return;   // adornment (and animated — never geometry)
  const c = cam.proj(dx, dy, z); if (c.f <= 0.12) return;
  const R = clamp(worldR / c.f, 4, 60), ang = (now || 0) * 0.0015 + seed, N = 9, sq = 0.62;   // vertical squash → seen at a rake
  emitFace(decoDepth(c.f), () => {
    ctx.globalAlpha = alpha;
    for (let i = 0; i < N; i++) {
      const a = ang + i / N * 6.2832, w = 0.30;
      ctx.fillStyle = i % 2 ? 'rgba(120,124,132,0.82)' : 'rgba(150,152,158,0.82)';   // alternating tin vanes
      ctx.beginPath(); ctx.moveTo(c.sx, c.sy);
      ctx.lineTo(c.sx + Math.cos(a - w) * R, c.sy + Math.sin(a - w) * R * sq);
      ctx.lineTo(c.sx + Math.cos(a) * R, c.sy + Math.sin(a) * R * sq);
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(60,58,58,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(c.sx, c.sy, R, 0, 7); ctx.stroke();   // rim band
    ctx.fillStyle = 'rgba(48,46,46,0.95)'; ctx.beginPath(); ctx.arc(c.sx, c.sy, R * 0.14, 0, 7); ctx.fill();                   // hub
    ctx.globalAlpha = 1;
  });
}
// A DEAD-STILL windsock: a thin pole with a striped cone hanging straight DOWN off the top (no
// wind in the Reach — the flavour text says it hangs limp). Pole z0→z1, sock drops below the tip.
function windsockLimp(ctx, cam, dx, dy, z0, z1, alpha) {
  if (SHAPE_SINK || ADORN_TIER < ADORN_CHEAP) return;   // adornment
  const b = cam.proj(dx, dy, z0), t = cam.proj(dx, dy, z1); if (b.f <= 0.12 || t.f <= 0.12) return;
  const drop = (z1 - z0) * 0.42, m1 = cam.proj(dx, dy, z1 - drop * 0.5), m2 = cam.proj(dx, dy, z1 - drop);
  if (m1.f <= 0.12 || m2.f <= 0.12) return;
  const w0 = clamp(4.5 / t.f, 1.2, 8), w1 = clamp(2.4 / m2.f, 0.6, 5);
  emitFace(decoDepth(b.f, t.f), () => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(150,150,156,0.9)'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(b.sx, b.sy); ctx.lineTo(t.sx, t.sy); ctx.stroke();   // pole
    const band = (pa, wa, pb, wb, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(pa.sx - wa, pa.sy); ctx.lineTo(pa.sx + wa, pa.sy); ctx.lineTo(pb.sx + wb, pb.sy); ctx.lineTo(pb.sx - wb, pb.sy); ctx.closePath(); ctx.fill(); };
    band(t, w0, m1, (w0 + w1) / 2, 'rgba(206,116,54,0.92)');
    band(m1, (w0 + w1) / 2, m2, w1, 'rgba(216,210,202,0.9)');
    ctx.globalAlpha = 1;
  });
}
// A hunched buzzard perched on a ridge/pole at world (dx,dy,z) — a tiny near-black silhouette.
function perchBird(ctx, cam, dx, dy, z, alpha) {
  if (SHAPE_SINK || ADORN_TIER < ADORN_CHEAP) return;   // adornment
  const p = cam.proj(dx, dy, z); if (p.f <= 0.12) return; const s = clamp(5.5 / p.f, 1.4, 9);
  emitFace(decoDepth(p.f), () => {
    ctx.globalAlpha = alpha; ctx.fillStyle = 'rgba(16,14,16,0.94)';
    ctx.beginPath(); ctx.ellipse(p.sx, p.sy - s * 0.5, s * 0.52, s * 0.8, 0, 0, 7); ctx.fill();          // hunched body
    ctx.beginPath(); ctx.arc(p.sx - s * 0.44, p.sy - s * 1.06, s * 0.3, 0, 7); ctx.fill();               // low-slung head
    ctx.fillRect(p.sx - s * 0.5, p.sy + s * 0.28, s, s * 0.14);                                          // the perch it grips
    ctx.globalAlpha = 1;
  });
}
// ── Region atmosphere grade (the "shader" that sells a place) ──────────────────
// A screen-space colour grade keyed by region id — the render-layer's cosmetic mood for a
// place, keyed to content identity exactly like NAMED_MODELS keys to a building name. It rides
// the region-distance the flight state already ships (contextPayload → v.regions: [{id,dist}…]),
// so it fades in as you approach and out as you leave, with NO hardcoded world coordinates here.
//   tint  — the dust/mood colour (multiply + soft-light lift)
//   sat   — how far to pull saturation OUT (0..1; 1 = full sepia)
//   dust  — corner-vignette + horizon dust-haze strength
//   near/far — tile distances (region-centroid) over which the grade ramps 1→0
const REGION_GRADE = {
  region_the_reach: { tint: [214, 150, 86], sat: 0.5, strength: 0.32, dust: 0.34, near: 2, far: 13 },
};
// Strongest applicable grade for this frame, or null. Weight is a smoothstep of the nearest
// graded region's centroid distance across its near→far band.
function regionGradeFor(v) {
  const rs = v && v.regions; if (!Array.isArray(rs)) return null;
  let best = null;
  for (const r of rs) {
    const g = REGION_GRADE[r && r.id]; if (!g) continue;
    const t = clamp((g.far - (r.dist || 0)) / Math.max(0.001, g.far - g.near), 0, 1);
    const w = t * t * (3 - 2 * t);   // smoothstep
    if (w > 0.001 && (!best || w > best.w)) best = { g, w };
  }
  return best;
}
// Composite the grade over the finished (unbanked) world: desaturate toward dusty, warm-multiply
// a sun-baked ochre in, lift the midtones, then a dirty vignette + a wavering horizon heat-haze.
// Runs BEFORE the canopy glass/prop overlays so the glass still sits cleanly on top. Gated on w>0,
// so it costs nothing outside a graded region.
function applyRegionGrade(ctx, W, H, horizonY, g, w, now, night) {
  if (w <= 0.002) return;
  const [tr, tg, tb] = g.tint;
  ctx.save();
  ctx.globalCompositeOperation = 'saturation';                                   // pull colour toward sepia
  ctx.globalAlpha = clamp(g.sat * w, 0, 1); ctx.fillStyle = 'rgb(128,128,128)'; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'multiply';                                      // sun-baked ochre wash
  ctx.globalAlpha = clamp(g.strength * w, 0, 1); ctx.fillStyle = `rgb(${tr},${tg},${tb})`; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'soft-light';                                    // lift the midtones (hot glare)
  ctx.globalAlpha = clamp(0.42 * w, 0, 1); ctx.fillStyle = `rgb(${tr},${tg},${tb})`; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  const vg = ctx.createRadialGradient(W / 2, H * 0.52, Math.min(W, H) * 0.22, W / 2, H * 0.52, Math.max(W, H) * 0.78);   // dust vignette
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(28,16,6,${clamp(g.dust * w, 0, 0.5)})`);
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  const hy = clamp(horizonY, 0, H), bandH = H * 0.18;                             // horizon dust-haze, wavering
  if (g.dust * w > 0.02 && hy < H) {
    const shimmer = (0.6 + 0.4 * Math.sin((now || 0) * 0.005)) * (1 - night * 0.5);
    const band = ctx.createLinearGradient(0, hy, 0, hy + bandH);
    band.addColorStop(0, `rgba(${tr},${tg},${tb},${clamp(0.2 * g.dust * w * shimmer, 0, 0.4)})`);
    band.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = band; ctx.fillRect(0, hy, W, bandH);
  }
  ctx.restore();
}
// ── Faceted-model primitives (the KSAB broadcast complex builds from these) ────
// Emit ONE solid world-space polygon (3–4 pts as [x,y,z]) as a depth-sorted flat face. It rides the
// SAME painter queue as draw3DBoxAt's walls (queued at the face's average forward depth), so the
// building's own mass and its neighbours occlude it correctly — it never punches through like a
// DECO_LIFT-ed sign. opts.cullN = a world-XY outward normal → backface-cull a vertical face turned
// away from the eye (same test the box walls use); opts.lift = a hair of forward bias for a face
// mounted flush on another (kept tiny, never the 0.6 that bleeds signs through walls).
function emitFlat(ctx, cam, pts, fill, alpha, opts = {}) {
  if (opts.cullN) {
    let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length;
    const nx = opts.cullN[0], ny = opts.cullN[1], bk = cam.back || 0;
    if (nx * cx + ny * cy + bk * (nx * cam.sinh - ny * cam.cosh) >= 0) return;   // face turned away → skip
  }
  const pr = pts.map(p => cam.proj(p[0], p[1], p[2]));
  if (pr.some(q => q.f <= 0.1)) return;   // any corner behind the eye → drop (rooftop deco, rarely this close)
  let d = 0; for (const q of pr) d += q.f; d = d / pr.length - (opts.lift || 0);
  emitFace(d, () => {
    ctx.globalAlpha = alpha;
    ctx.beginPath(); pr.forEach((q, i) => i ? ctx.lineTo(q.sx, q.sy) : ctx.moveTo(q.sx, q.sy)); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (opts.stroke) { ctx.strokeStyle = opts.stroke; ctx.lineWidth = opts.lw || 1; ctx.stroke(); }
    ctx.globalAlpha = 1;
  });
}
// A SAWTOOTH north-light roof (the classic sound-stage/factory monitor roof) laid over a mass roof at
// z0. `teeth` ridges repeat front→back: each is a sloped roofing panel rising to a ridge, a VERTICAL
// glazed north-light face dropping back down (faces the entrance side), and the two triangular gable
// ENDS that give the silhouette its saw. hx/hy are the roof-deck half-extents in the model-local frame.
function sawtoothRoof(ctx, cam, dx, dy, E, hx, hy, z0, rh, teeth, roofc, glassc, edge, alpha) {
  // Captured HERE and not in emitFlat: this roof is built entirely out of emitFlat, so hooking both
  // would record the same geometry twice. The four direct emitFlat calls elsewhere in the arms are
  // decorative (a studio visor, a buzzard triangle) and are deliberately not captured at all.
  if (SHAPE_SINK) { SHAPE_SINK.push({ kind: 'sawtooth', dx, dy, hx, hy, wz0: z0, rh, teeth, pal: SHAPE_PAL, roofc, glassc, edge }); return; }
  if (MASS_OFF) return;   // adornments-only pass — the distance LOD draws this mass from captured segments
  const L = (lx, ly, z) => { const w = facePt(dx, dy, lx, ly, E); return [w[0], w[1], z]; };
  const px = E[1], py = -E[0], step = (2 * hy) / teeth;
  for (let i = 0; i < teeth; i++) {
    const yb = -hy + i * step, yr = yb + step;   // slab back edge → ridge (front) edge
    emitFlat(ctx, cam, [L(-hx, yb, z0), L(hx, yb, z0), L(hx, yr, z0 + rh), L(-hx, yr, z0 + rh)], roofc, alpha, { stroke: edge, lw: 1 });                                     // sloped roofing panel (top-facing)
    emitFlat(ctx, cam, [L(-hx, yr, z0 + rh), L(hx, yr, z0 + rh), L(hx, yr, z0), L(-hx, yr, z0)], glassc, alpha, { stroke: edge, lw: 1, cullN: [E[0], E[1]] });               // vertical north-light glazing
    emitFlat(ctx, cam, [L(hx, yb, z0), L(hx, yr, z0 + rh), L(hx, yr, z0)], roofc, alpha, { stroke: edge, lw: 1, cullN: [px, py] });                                         // right gable-end triangle
    emitFlat(ctx, cam, [L(-hx, yb, z0), L(-hx, yr, z0 + rh), L(-hx, yr, z0)], roofc, alpha, { stroke: edge, lw: 1, cullN: [-px, -py] });                                    // left gable-end triangle
  }
}
// A triangular BROADCAST LATTICE tower on the rear roof: three tapering legs with X-braced belts (the
// diagonals are the triangles) + a red aviation beacon. Pure stroke-work queued per segment at its own
// depth (a hair forward so it beats the roof it stands on, nowhere near enough to bleed through the mass).
function latticeTower(ctx, cam, dx, dy, z0, z1, r0, r1, alpha, now, seed) {
  if (SHAPE_SINK || ADORN_TIER < ADORN_RICH) return;   // stroke-only silhouette, not solid mass
  const S = 3, H = 4;
  const corner = (i, z) => { const t = (z - z0) / (z1 - z0), r = r0 + (r1 - r0) * t, a = i / S * Math.PI * 2 + 0.5; return [dx + Math.cos(a) * r, dy + Math.sin(a) * r, z]; };
  const seg = (A, B, w, c) => {
    const a = cam.proj(A[0], A[1], A[2]), b = cam.proj(B[0], B[1], B[2]);
    if (a.f <= 0.1 || b.f <= 0.1) return;
    emitFace(Math.min(a.f, b.f) - 0.03, () => { ctx.globalAlpha = alpha; ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); ctx.globalAlpha = 1; });
  };
  const leg = 'rgba(202,208,222,0.9)', brace = 'rgba(150,120,210,0.72)';
  for (let i = 0; i < S; i++) seg(corner(i, z0), corner(i, z1), 1.3, leg);                                  // 3 legs
  for (let k = 0; k < H; k++) {
    const za = z0 + (z1 - z0) * (k / H), zb = z0 + (z1 - z0) * ((k + 1) / H);
    for (let i = 0; i < S; i++) {
      const j = (i + 1) % S;
      seg(corner(i, za), corner(j, za), 0.9, brace);                                                        // horizontal belt
      seg(corner(i, za), corner(j, zb), 0.8, brace); seg(corner(j, za), corner(i, zb), 0.8, brace);         // X-brace (the triangles)
    }
  }
  for (let i = 0; i < S; i++) seg(corner(i, z1), corner((i + 1) % S, z1), 0.9, brace);                      // top belt
  blinkLight(ctx, cam, dx, dy, z1, '255,80,80', now, seed, alpha, 1.8);                                     // aviation beacon
}
// ── Surface text: procedural sign art painted INTO a face ─────────────────────
// The old marquees stamped upright glyphs at foreshortened POSITIONS, so the letter
// shapes never leaned with the wall — they read as a billboard that swivels to keep
// facing you as you fly past. Instead we BAKE the label once to an offscreen neon
// texture (memoised per label|colour|day-night|orientation) and MAP that texture onto
// the face's real projected quad by strip subdivision. Canvas offers only affine (3-point,
// parallelogram) transforms, so a single map trapezoids on oblique faces; slicing the quad
// into thin strips along the text axis and affine-mapping each keeps the per-strip error
// invisible — an approximate perspective map. The result foreshortens and shears with the
// surface and stays welded to it from every angle. `bakeSignText` returns a transparent-bg
// canvas (dark-edged white core + colour halo); the caller still draws its own backing board.
const _signTexCache = new Map();   // key `label|color|dn|vertical` → offscreen neon-glyph canvas
let _bladeSign;   // ambient: the current building's display name, set by drawTypeModel so its neonBlades paint real letters without threading the name through every call site (same idiom as FACE_SINK)
function bakeSignText(label, color, dn, vertical) {
  if (SHAPE_SINK || ADORN_TIER < ADORN_RICH) return null;   // adornment — and it allocates a canvas, which capture must never do
  const key = `${label}|${color}|${dn}|${vertical ? 1 : 0}`;
  let c = _signTexCache.get(key); if (c) return c;
  const n = label.length, CELL = 46, PAD = 8;   // logical px per glyph cell + margin; the strip map scales this onto the quad
  const W = vertical ? CELL : n * CELL + PAD * 2, H = vertical ? n * CELL + PAD * 2 : CELL;
  c = texCanvas(W, H); const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${Math.round(CELL * 0.72)}px monospace`;
  const glow = dn ? 12 : 6, core = dn ? 6 : 2;
  const put = (ch, x, y) => {
    g.shadowColor = color; g.shadowBlur = glow; g.fillStyle = color; g.fillText(ch, x, y);            // colour halo
    g.shadowBlur = core; g.lineWidth = 2.4; g.strokeStyle = 'rgba(8,6,10,0.9)'; g.strokeText(ch, x, y); // dark edge
    g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,0.95)'; g.fillText(ch, x, y);                    // bright core
  };
  if (vertical) for (let i = 0; i < n; i++) put(label[i], W / 2, PAD + (i + 0.5) * CELL);
  else put(label, W / 2, H / 2);
  _signTexCache.set(key, c); return c;
}
// Map a baked texture onto a projected quad [TL,TR,BR,BL] ({sx,sy}) by strip subdivision.
// `vertical` runs the strips down the column (letters top→bottom) vs across the band. Must be
// called INSIDE an emitFace closure — it is pure screen-space drawing and composes onto the
// current (DPR) transform via ctx.transform, never setTransform, so it stays in world scale.
function drawSurfaceText(ctx, TL, TR, BR, BL, tex, vertical, alpha) {
  if (SHAPE_SINK || ADORN_TIER < ADORN_RICH) return;   // adornment
  const W = tex.width, H = tex.height, S = 8;
  const at = (P, Q, t) => ({ x: P.sx + (Q.sx - P.sx) * t, y: P.sy + (Q.sy - P.sy) * t });
  for (let i = 0; i < S; i++) {
    const s0 = i / S, s1 = Math.min(1, (i + 1) / S + 0.004);   // hair of overlap kills strip seams
    let p0, p1, p2, sx, sy, sw, sh;
    if (vertical) {                                             // strips stacked down the column
      p0 = at(TL, BL, s0); p1 = at(TR, BR, s0); p2 = at(TL, BL, s1);
      sx = 0; sy = s0 * H; sw = W; sh = (s1 - s0) * H;
    } else {                                                    // strips across the band
      p0 = at(TL, TR, s0); p1 = at(TL, TR, s1); p2 = at(BL, BR, s0);
      sx = s0 * W; sy = 0; sw = (s1 - s0) * W; sh = H;
    }
    if (sw <= 0 || sh <= 0) continue;
    const a = (p1.x - p0.x) / sw, b = (p1.y - p0.y) / sw, cc = (p2.x - p0.x) / sh, d = (p2.y - p0.y) / sh;
    const e = p0.x - (a * sx + cc * sy), f = p0.y - (b * sx + d * sy);
    if (!isFinite(a) || !isFinite(d)) continue;
    ctx.save(); ctx.globalAlpha = alpha; ctx.transform(a, b, cc, d, e, f);
    ctx.drawImage(tex, sx, sy, sw, sh, sx, sy, sw, sh); ctx.restore();
  }
}
function neonBlade(ctx, cam, dx, dy, h0, h1, color, night, alpha, label) {   // vertical marquee blade
  if (SHAPE_SINK || ADORN_TIER < ADORN_RICH) return;   // adornment — a stacked sign board; a label (explicit, or the ambient building name) paints real letters onto the blade face
  if (label === undefined) label = _bladeSign;   // default to the current building's name; pass '' to force the abstract rungs
  const b = cam.proj(dx, dy, h0), t = cam.proj(dx, dy, h1); if (b.f <= 0.12 || t.f <= 0.12) return;
  const ux = t.sx - b.sx, uy = t.sy - b.sy, len = Math.hypot(ux, uy) || 1;
  const wpx = clamp(9 / ((b.f + t.f) / 2), 2, 9);            // blade half-width (screen px), distance-scaled
  const nx = -uy / len * wpx, ny = ux / len * wpx;           // perpendicular half-width offset
  const P = [[b.sx + nx, b.sy + ny], [t.sx + nx, t.sy + ny], [t.sx - nx, t.sy - ny], [b.sx - nx, b.sy - ny]];
  const glow = glowEarned(night, (b.f + t.f) / 2);   // the bloom is the expensive half of neon
  // Sort as a building-mounted deco (lifted DECO_LIFT tiles forward), not by its raw average depth:
  // a back-corner blade's average sits BEHIND its own tile-centered roof cap, so the two flip-flop in
  // the painter queue and the sign flashes on/off as the camera swings past (same fix as marqueeBand).
  emitFace(decoDepth(b.f, t.f), () => {
    const trace = () => { ctx.beginPath(); P.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); };
    ctx.save();
    ctx.globalAlpha = alpha * (night ? 0.92 : 0.84); ctx.fillStyle = '#120d12'; trace(); ctx.fill();   // backing board
    ctx.globalAlpha = alpha * (night ? 0.8 : 0.55); ctx.fillStyle = color;                              // colour-lit face
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 8; }
    trace(); ctx.fill(); ctx.shadowBlur = 0;
    if (label) {   // real letters painted DOWN the blade face (top→bottom), foreshortened with it
      const q = (p) => ({ sx: p[0], sy: p[1] });
      drawSurfaceText(ctx, q(P[1]), q(P[2]), q(P[3]), q(P[0]), bakeSignText(label, color, night ? 1 : 0, true), true, alpha);
    } else {   // no name → the old abstract "letter" rungs
      const N = clamp(Math.round(len / 8), 3, 8);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1;
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 4; }
      for (let i = 1; i < N; i++) {
        const s = i / N, cx = b.sx + ux * s, cy = b.sy + uy * s;
        ctx.globalAlpha = alpha * (night ? 0.9 : 0.68);
        ctx.beginPath(); ctx.moveTo(cx + nx * 0.55, cy + ny * 0.55); ctx.lineTo(cx - nx * 0.55, cy - ny * 0.55); ctx.stroke();
      }
    }
    ctx.restore();
  });
}
// A projecting LIT marquee — a SOLID triangular prism (the old marquee blade, filled in) that juts out
// from the wall along the outward normal `N`. Its horizontal cross-section is a TRIANGLE with three
// flat sides: the base edge lies flush against the building (±baseH along the wall) and the two slanted
// SIDE faces run out to a shared apex EDGE (a vertical ridge at projD). Both slanted faces are FLAT
// vertical quads (full height h0→h1) and BOTH carry the stacked sign name (EMBASSY), painted straight
// onto the real foreshortened face (canvas paint, not a billboard), legible from either approach. The
// third side is against the wall. Per-face backface culling shows only the side facing you, so lettering
// both never doubles the glyphs. Top/bottom cap triangles fill the prism into a solid.
function verticalMarquee(ctx, cam, dx, dy, h0, h1, label, color, night, alpha, N) {
  if (SHAPE_SINK || ADORN_TIER < ADORN_RICH) return;   // adornment
  const n = label.length; if (!n) return;
  N = N || [0, 1];
  const ax = N[1], ay = -N[0], baseH = 0.045, projD = 0.15, bk = cam.back || 0;    // along-wall unit; base half-width + apex-ridge projection (tiles)
  const baseL = [dx - ax * baseH, dy - ay * baseH], baseR = [dx + ax * baseH, dy + ay * baseH], apex = [dx + N[0] * projD, dy + N[1] * projD];
  const board = () => { ctx.globalAlpha = alpha; ctx.fillStyle = '#0e0a0f'; };     // dark backing fill
  const mGlow = glowEarned(night, cam.proj(dx, dy, (h0 + h1) / 2).f);   // one distance for the whole sign
  const frame = () => { ctx.globalAlpha = alpha * (night ? 0.5 : 0.32); ctx.strokeStyle = color; ctx.lineWidth = 1.2; if (mGlow) { ctx.shadowColor = color; ctx.shadowBlur = 7; } ctx.stroke(); ctx.shadowBlur = 0; };
  const drawFace = (A, B) => {   // one FLAT slanted side, horizontal plan edge A→B (wall corner → apex ridge), full height h0..h1
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
    let nfx = B[1] - A[1], nfy = -(B[0] - A[0]);                                   // outward normal ⊥ to the edge
    if (nfx * (mx - dx) + nfy * (my - dy) < 0) { nfx = -nfx; nfy = -nfy; }         // point away from the prism axis
    if (nfx * mx + nfy * my + bk * (nfx * cam.sinh - nfy * cam.cosh) >= 0) return; // face turned away → cull
    const At = cam.proj(A[0], A[1], h1), Bt = cam.proj(B[0], B[1], h1), Bb = cam.proj(B[0], B[1], h0), Ab = cam.proj(A[0], A[1], h0);
    if ([At, Bt, Bb, Ab].some(q => q.f <= 0.12)) return;
    emitFace(Math.min(At.f, Bt.f, Bb.f, Ab.f) - 0.04, () => {                      // bias forward so it beats the wall it's mounted on
      ctx.save();
      board();
      ctx.beginPath(); ctx.moveTo(At.sx, At.sy); ctx.lineTo(Bt.sx, Bt.sy); ctx.lineTo(Bb.sx, Bb.sy); ctx.lineTo(Ab.sx, Ab.sy); ctx.closePath(); ctx.fill();
      frame();
      drawSurfaceText(ctx, At, Bt, Bb, Ab, bakeSignText(label, color, night ? 1 : 0, true), true, alpha);   // EMBASSY down the flat face
      ctx.restore();
    });
  };
  const drawCap = (hz) => {   // top or bottom triangle (baseL, baseR, apex at height hz) — fills the prism into a solid (dark, no text)
    const A = cam.proj(baseL[0], baseL[1], hz), B = cam.proj(baseR[0], baseR[1], hz), Ap = cam.proj(apex[0], apex[1], hz);
    if ([A, B, Ap].some(q => q.f <= 0.12)) return;   // far cap sorts behind and is over-painted by the near side face; no cull needed
    emitFace(Math.min(A.f, B.f, Ap.f) - 0.04, () => {
      ctx.save();
      board();
      ctx.beginPath(); ctx.moveTo(A.sx, A.sy); ctx.lineTo(B.sx, B.sy); ctx.lineTo(Ap.sx, Ap.sy); ctx.closePath(); ctx.fill();
      frame();
      ctx.restore();
    });
  };
  drawCap(h1); drawCap(h0);        // top & bottom caps first (deepest), then the lettered flat sides over them
  drawFace(baseL, apex);           // front slanted face — EMBASSY
  drawFace(apex, baseR);           // back slanted face  — EMBASSY (the third side, baseR→baseL, is against the wall)
}
// Does a sign at this camera distance earn a real blurred halo? See RENDER_TUNE.glowFar — the blur
// is the expensive part of neon, and beyond a handful of tiles it is smaller than a pixel.
const glowEarned = (night, f) => !!night && f < (RENDER_TUNE.glowFar || 0);

// A soft radial blob, baked ONCE per colour into a small offscreen canvas and thereafter blitted.
//
// glowPool used to build a fresh radial gradient every call — profiling counted 141 gradient
// constructions per frame from the skyline alone, and gradient construction is one of the two
// things (with shadowBlur) that actually cost real time in canvas2d. A radial falloff is the same
// shape at every size, so there is nothing to recompute: bake it at a fixed radius, then scale on
// blit. Alpha rides on globalAlpha rather than in the gradient stops, which is what lets one sprite
// serve every intensity.
//
// Cached per RGB string; the palette is small and fixed, so this converges to a handful of 64px
// canvases within the first second and never allocates again.
const _glowSprites = new Map();
const GLOW_SPRITE_R = 32;   // baked radius in px; blit scales from this
function glowSprite(rgb) {
  let c = _glowSprites.get(rgb);
  if (c) return c;
  c = texCanvas(GLOW_SPRITE_R * 2, GLOW_SPRITE_R * 2);
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(GLOW_SPRITE_R, GLOW_SPRITE_R, 1, GLOW_SPRITE_R, GLOW_SPRITE_R, GLOW_SPRITE_R);
  rg.addColorStop(0, `rgba(${rgb},1)`); rg.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = rg; g.fillRect(0, 0, GLOW_SPRITE_R * 2, GLOW_SPRITE_R * 2);
  _glowSprites.set(rgb, c);
  return c;
}
function glowPool(ctx, cam, dx, dy, wz, rgb, s0, alpha) {   // soft ground/roof glow (generalised ruin glow)
  if (SHAPE_SINK || ADORN_TIER < ADORN_RICH) return;   // adornment
  if (PERF.on) PERF.n.adorn++;
  const g = cam.proj(dx, dy, wz); if (g.f <= 0.12) return; const s = clamp(s0 / g.f, 3, 60);
  const sp = glowSprite(rgb);
  emitFace(decoDepth(g.f), () => {
    ctx.globalAlpha = alpha;
    ctx.drawImage(sp, g.sx - s, g.sy - s, s * 2, s * 2);
    ctx.globalAlpha = 1;
  });
}
// A HORIZONTAL marquee SIGN across a building's entrance face (a hotel/bar marquee), at
// height wz, spanning ±half across the front edge (E = entrance world vector). Drawn as a
// real lit sign board — a dark backing panel, a colour-lit face, a frame, and a row of
// marquee bulbs along the top & bottom rails — so it reads as signage in daylight instead
// of a bare stroke (which is all it used to be).
function marqueeBand(ctx, cam, dx, dy, E, half, wz, color, night, alpha, label) {
  if (SHAPE_SINK || ADORN_TIER < ADORN_RICH) return;   // adornment
  const px = E[1] * half, py = -E[0] * half;                 // across-front half-width
  const ox = E[0] * half * 0.94, oy = E[1] * half * 0.94;    // pushed out to the front face
  const hh = Math.min(clamp(half * 0.26, 0.045, 0.12), Math.max(0.03, wz * 0.85));   // sign half-height (world-z), never dips below the base
  const Lx = dx - px + ox, Ly = dy - py + oy, Rx = dx + px + ox, Ry = dy + py + oy;
  const tl = cam.proj(Lx, Ly, wz + hh), tr = cam.proj(Rx, Ry, wz + hh);
  const bl = cam.proj(Lx, Ly, wz - hh), br = cam.proj(Rx, Ry, wz - hh);
  if ([tl, tr, bl, br].some((p) => p.f <= 0.12)) return;
  const quad = () => { ctx.beginPath(); ctx.moveTo(tl.sx, tl.sy); ctx.lineTo(tr.sx, tr.sy); ctx.lineTo(br.sx, br.sy); ctx.lineTo(bl.sx, bl.sy); ctx.closePath(); };
  // Sort at the sign's own quad depth with a HAIR of forward bias: a raw average is coplanar with the
  // wall it's mounted on, so painter's-sort order flip-flops and the sign flickers — a tiny 0.06 lift
  // fixes that deterministically. Deliberately NOT the full decoDepth (DECO_LIFT = 0.6): a wall-sized
  // sign lifted 0.6 tiles forward jumps in front of a NEARER neighbour (KSAB's board bled over the
  // Solenne tower two tiles away). Pushed proud of its own wall, this still self-occludes when the
  // front faces away (the sign lands behind the near wall) without leaping onto neighbours.
  emitFace((tl.f + tr.f + bl.f + br.f) / 4 - 0.06, () => {
  ctx.save();
  // 1. dark backing board
  ctx.globalAlpha = alpha * (night ? 0.94 : 0.86); ctx.fillStyle = '#140f14'; quad(); ctx.fill();
  // 2. colour-lit sign face (glows at night)
  ctx.globalAlpha = alpha * (night ? 0.82 : 0.6); ctx.fillStyle = color;
  if (glowEarned(night, (tl.f + br.f) / 2)) { ctx.shadowColor = color; ctx.shadowBlur = 8; }   // bloom only where it's bigger than a pixel
  quad(); ctx.fill(); ctx.shadowBlur = 0;
  // 3. metal frame
  ctx.globalAlpha = alpha; ctx.strokeStyle = 'rgba(18,14,18,0.9)'; ctx.lineWidth = 1.3; quad(); ctx.stroke();
  // 4. marquee bulbs along the top & bottom rails
  const wpx = Math.hypot(tr.sx - tl.sx, tr.sy - tl.sy);
  const N = clamp(Math.round(wpx / 9), 4, 16);
  if (night) { ctx.shadowColor = color; ctx.shadowBlur = 5; }
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    for (const [P, Q] of [[tl, tr], [bl, br]]) {
      const sx = P.sx + (Q.sx - P.sx) * t, sy = P.sy + (Q.sy - P.sy) * t;
      ctx.globalAlpha = alpha * (night ? 0.95 : 0.82); ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(sx, sy, night ? 1.5 : 1.2, 0, 7); ctx.fill();
      ctx.globalAlpha = alpha * (night ? 0.85 : 0.55); ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(sx, sy, 0.5, 0, 7); ctx.fill();
    }
  }
  ctx.shadowBlur = 0;
  // 5. the sign lettering — a baked neon texture mapped ONTO the band's real projected quad
  // (foreshortens/leans with the face) instead of a flat rotate-and-squeeze that read as upright.
  if (label) drawSurfaceText(ctx, tl, tr, br, bl, bakeSignText(label, color, night ? 1 : 0, false), false, alpha);
  ctx.restore();
  });
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

// A high-poly gothic GARGOYLE / grotesque perched on a cornice, craning outward over the drop.
// Built in a LOCAL frame anchored at (wx,wy,wz): +f (forward) = the horizontal `outDir` it leans
// over, +u = up, +r = right (outDir rotated -90°); one `size` scales the whole beast uniformly.
// A swept elliptical-ring SPINE makes the crouched body → arched hunch → craned neck → horned skull
// → snout as one continuous stone mass; tapered tubes make the bracing forelimbs, coiled haunches
// and back-swept horns; thin double-sided membranes make the folded bat wings; a dropped wedge is
// the open lower jaw. Matte weathered limestone — a single top-front key light + soot-darkened
// undersides — each face pushed through the shared building FACE_SINK (so the cornice/tower occlude
// it), backface-culled (wings excepted). Stone: no gloss, no neon.
function drawGargoyle(ctx, cam, wx, wy, wz, size, outDir, alpha, night, seed) {
  if (SHAPE_SINK || ADORN_TIER < ADORN_RICH) return;   // adornment — the Meridian's beasts are ornament, not envelope
  const om = Math.hypot(outDir[0], outDir[1]) || 1, fX = outDir[0] / om, fY = outDir[1] / om;
  const rX = fY, rY = -fX;                                                     // right = outward rotated -90°
  const L = (r, f, u) => [wx + (rX * r + fX * f) * size, wy + (rY * r + fY * f) * size, wz + u * size];
  const faces = [];
  const push = (p, opt) => faces.push(Object.assign({ p }, opt));
  // Swept tube along a spine of stations [centreR, forward, up, halfWidth, halfHeight]; NA facets
  // around, elliptical section in the right×up plane. Optional near-pointed caps at either end.
  const tube = (S, NA, capA, capB, opt) => {
    const ring = (st) => { const a = []; for (let k = 0; k < NA; k++) { const th = k / NA * 6.2832; a.push([st[0] + Math.cos(th) * st[3], st[1], st[2] + Math.sin(th) * st[4]]); } return a; };
    let prev = ring(S[0]);
    for (let i = 1; i < S.length; i++) {
      const cur = ring(S[i]);
      for (let k = 0; k < NA; k++) { const k2 = (k + 1) % NA; push([prev[k], prev[k2], cur[k2], cur[k]], opt); }
      prev = cur;
    }
    if (capA) { const s = S[0], apex = [s[0], s[1] - s[3] * 0.9, s[2]], r0 = ring(s); for (let k = 0; k < NA; k++) push([r0[k], r0[(k + 1) % NA], apex], opt); }
    if (capB) { const s = S[S.length - 1], apex = [s[0], s[1] + s[3] * 0.9, s[2]], rN = ring(s); for (let k = 0; k < NA; k++) push([rN[(k + 1) % NA], rN[k], apex], opt); }
  };
  // ── Body: curled tail → coiled haunches → arched hunched back → craned neck → skull → snout ──
  tube([
    [0, -0.56, 0.50, 0.06, 0.06],   // tail tip, curled up behind the rump
    [0, -0.44, 0.30, 0.15, 0.16],   // haunch mass
    [0, -0.20, 0.34, 0.22, 0.24],   // lower back
    [0,  0.04, 0.46, 0.24, 0.25],   // hunched, arched mid-back
    [0,  0.24, 0.40, 0.21, 0.21],   // shoulders
    [0,  0.40, 0.31, 0.15, 0.16],   // neck base
    [0,  0.56, 0.20, 0.12, 0.13],   // craning neck (down + out)
    [0,  0.74, 0.14, 0.14, 0.13],   // skull
    [0,  0.92, 0.10, 0.12, 0.10],   // muzzle base
    [0,  1.10, 0.05, 0.06, 0.05],   // snout tip
  ], 8, true, true);
  // ── Bracing FORELIMBS — shoulders down-forward to claws gripping the ledge lip ──
  for (const s of [-1, 1]) tube([
    [s * 0.19, 0.26, 0.34, 0.07, 0.08],
    [s * 0.23, 0.40, 0.16, 0.06, 0.07],
    [s * 0.27, 0.54, 0.01, 0.08, 0.04],   // splayed clawed grip
  ], 6, false, true);
  // ── Coiled HAUNCHES → hind paws on the ledge ──
  for (const s of [-1, 1]) tube([
    [s * 0.22, -0.36, 0.26, 0.10, 0.12],
    [s * 0.26, -0.24, 0.10, 0.07, 0.08],
    [s * 0.29, -0.12, 0.00, 0.09, 0.04],
  ], 6, false, true);
  // ── Back-swept HORNS from the skull ──
  for (const s of [-1, 1]) tube([
    [s * 0.07, 0.74, 0.22, 0.045, 0.05],
    [s * 0.11, 0.68, 0.34, 0.028, 0.03],
    [s * 0.15, 0.60, 0.44, 0.010, 0.012],   // horn tip
  ], 5, false, false);
  // ── Folded bat WINGS — thin double-sided membranes fanning up above the shoulders ──
  for (const s of [-1, 1]) {
    const root = [s * 0.15, 0.16, 0.42];
    const spar = [[s * 0.34, -0.04, 0.82], [s * 0.30, -0.20, 0.74], [s * 0.22, -0.34, 0.58], [s * 0.16, -0.36, 0.34]];
    for (let i = 0; i < spar.length - 1; i++) push([root, spar[i], spar[i + 1]], { two: 1 });
  }
  // ── Open lower JAW — a dropped wedge under the snout ──
  { const bl = [-0.10, 0.90, 0.02], br = [0.10, 0.90, 0.02], tl = [-0.05, 1.10, -0.06], tr = [0.05, 1.10, -0.06];
    push([bl, br, tr, tl]);                                     // jaw floor
    push([[-0.10, 0.90, 0.07], [0.10, 0.90, 0.07], br, bl]); }  // jaw back
  // ── Shade + fill (matte weathered limestone), each face depth-queued via emitFace ──
  const KL = (() => { const v = [0.42, -0.34, 0.86], m = Math.hypot(v[0], v[1], v[2]); return [v[0] / m, v[1] / m, v[2] / m]; })();   // top-front key
  const camPos = [-(cam.back || 0) * cam.sinh, (cam.back || 0) * cam.cosh, cam.EH];
  const ctr = L(0, 0.1, 0.30);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const base = night ? [64, 62, 56] : [140, 134, 118];
  for (const fc of faces) {
    const wp = fc.p.map((p) => L(p[0], p[1], p[2]));
    const sp = wp.map((w) => cam.proj(w[0], w[1], w[2]));
    if (sp.some((q) => q.f <= 0.08)) continue;
    const e1 = sub(wp[1], wp[0]), e2 = sub(wp[2], wp[0]);
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nm = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / nm, n[1] / nm, n[2] / nm];
    const cen = [(wp[0][0] + wp[1][0] + wp[2][0]) / 3, (wp[0][1] + wp[1][1] + wp[2][1]) / 3, (wp[0][2] + wp[1][2] + wp[2][2]) / 3];
    if (fc.two) { if (dot(n, sub(camPos, cen)) < 0) n = [-n[0], -n[1], -n[2]]; }
    else { if (dot(n, sub(cen, ctr)) < 0) n = [-n[0], -n[1], -n[2]]; if (dot(n, sub(camPos, cen)) <= 0) continue; }
    let lm = 0.30 + 0.66 * Math.max(0, dot(n, KL));
    if (n[2] < 0) lm *= 0.62;                                   // soot-stained undersides
    lm = clamp(lm, 0.14, 1.05);
    const af = sp.reduce((s, q) => s + q.f, 0) / sp.length, fog = fogWeight(af);
    const r = base[0] * lm | 0, g = base[1] * lm | 0, b = base[2] * lm | 0;
    emitFace(af, () => {
      ctx.globalAlpha = alpha; ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath(); sp.forEach((q, i) => i ? ctx.lineTo(q.sx, q.sy) : ctx.moveTo(q.sx, q.sy)); ctx.closePath(); ctx.fill();
      if (fog > 0.004) { ctx.globalAlpha = alpha * fog; ctx.fillStyle = FOG_STATE.css; ctx.fill(); }
      ctx.globalAlpha = 1;
    });
  }
}

// A dedicated named-building model: a type-appropriate silhouette built from draw3DBoxAt +
// the adornments above, coloured by the building's own palette (m.pal) and neon (m.neon).
// `E` is the entrance world-vector (faceVec) so the door/forecourt points at the street.
function drawTypeModel(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E = [0, 1], name = '') {
  const pal = m.pal;
  // The building's display name, upper-cased for signage. Published as the ambient blade sign so
  // every neonBlade in this pass paints the real name; undefined (no name) → the abstract rungs.
  if (PERF.on) PERF.n.arms++;
  if (SHAPE_SINK) SHAPE_PAL = m.pal;   // ambient palette for the non-box mass primitives (capture only)
  const sign = (name || '').trim().toUpperCase() || undefined;
  _bladeSign = sign;
  const F = (lx, ly) => facePt(dx, dy, lx, ly, E);   // model-local → world, rotated to the entrance
  // Front-face (entrance/marquee side) visibility: its outward normal is E, so the face points
  // at the camera when E·(camera − faceCentre) > 0 — same test as the box backface cull, folding
  // in the external-view chase offset. When the front is turned away we skip the signage/marquee
  // (it lives ON that face) instead of letting it float through the building from behind.
  const frontVis = (E[0] * (dx + E[0] * fh) + E[1] * (dy + E[1] * fh) + (cam.back || 0) * (E[0] * cam.sinh - E[1] * cam.cosh)) < 0;
  switch (m.type) {
    case 'bank': {   // Citadel Financial — a windowless marble strongbox pretending to be a temple.
      // Deliberately the archive's austere cousin: same civic vocabulary (stylobate, colonnade,
      // entablature) with every window taken out, because the whole building is one wall. Four
      // columns, a bronze entrance band under the portico, a blank attic block, and a floodlit
      // frontage at night — no neon, nothing that could be switched off.
      const stone = pal, colPal = 'ty_marble_col', bronze = 'ty_marble_bronze';
      const plinth = h * 0.16, colTop = h * 0.88, entTop = h * 1.04, atticTop = h * 1.22;
      // 1) Two broad stone steps up off the deck.
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.34, 0, h * 0.08, stone, seed, night, alpha, false);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.20, h * 0.08, plinth, stone, seed + 1, night, alpha, false);
      // 2) The strongbox itself — one solid windowless mass. This is the whole point of the model.
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, plinth, colTop, stone, seed + 2, night, alpha, false);
      // 3) Four fluted columns standing proud of it on the entrance side.
      for (let i = 0; i < 4; i++) {
        const [cx, cy] = F((-0.9 + i * 0.6) * fh * 0.98, fh * 1.10);
        draw3DBoxAt(ctx, cam, cx, cy, fh * 0.11, plinth, colTop, colPal, seed + 10 + i, night, alpha, false);
      }
      // 4) Heavy entablature over the colonnade, and the blank attic block above it.
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.16, colTop, entTop, stone, seed + 3, night, alpha, false);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.82, entTop, atticTop, stone, seed + 4, night, alpha, false);
      // 5) The bronze doors — a dark band recessed under the portico, front face only.
      if (frontVis) {
        const [bx, by] = F(0, fh * 0.96);
        draw3DBoxAt(ctx, cam, bx, by, fh * 0.30, plinth, plinth + h * 0.30, bronze, seed + 5, night, alpha, false);
        // Floodlights wash the columns from the step line up — the frontage is never dark.
        glowPool(ctx, cam, bx, by, plinth + h * 0.06, '236,226,200', 11, alpha * (night ? 0.75 : 0.3));
      }
      // 6) Rooftop plant and one steady red obstruction light. No beacon theatrics.
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.30, atticTop, atticTop + h * 0.10, colPal, seed + 6, night, alpha, false);
      blinkLight(ctx, cam, dx, dy, atticTop + h * 0.14, '255,90,80', now, seed, alpha, 1);
      break;
    }
    case 'archive': {   // Hall of Records — the oldest thing on the skyline: a weathered stone
      // civic temple. A stepped stylobate lifts a six-column portico under a heavy entablature and
      // a classical pediment; behind it a drum of clerestory windows carries a verdigris copper
      // dome, a stone lantern and one lonely amber beacon. No neon — it predates all that. At
      // night it's floodlit from below like a monument nobody funds and nobody dares raze.
      const stone = pal, colPal = 'ty_archive_col';
      const plinth = h * 0.22, colTop = h * 1.02, entTop = h * 1.20;
      // 1) Stepped stone plinth (stylobate) — three broad shrinking steps up off the deck.
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.42, 0,        h * 0.07, stone, seed,     night, alpha, true);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.30, h * 0.07, h * 0.14, stone, seed + 1, night, alpha, true);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.18, h * 0.14, plinth,   stone, seed + 2, night, alpha, true);
      // 2) The cella — the solid records block behind the columns, warm windows lit.
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, plinth, colTop, stone, seed + 3, night, alpha, true);
      // 3) Front colonnade — six columns standing proud of the cella on the entrance side.
      for (let i = 0; i < 6; i++) {
        const [cx, cy] = F((-1 + i * 0.4) * fh * 0.98, fh * 1.12);
        draw3DBoxAt(ctx, cam, cx, cy, fh * 0.10, plinth, colTop, colPal, seed + 10 + i, night, alpha, false);
      }
      // 4) Heavy entablature capping the columns and cella.
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.14, colTop, entTop, stone, seed + 4, night, alpha, false);
      // 5) Classical pediment — a stone gable triangle over the portico (front face only) + the
      //    great warm rose-window/clock set into it.
      if (frontVis) {
        const [lx, ly] = F(-fh * 1.02, fh * 1.02), [rx, ry] = F(fh * 1.02, fh * 1.02), [ax, ay] = F(0, fh * 1.02);
        const a = cam.proj(lx, ly, entTop), b = cam.proj(rx, ry, entTop), c = cam.proj(ax, ay, entTop + h * 0.17);
        if (a.f > 0.1 && b.f > 0.1 && c.f > 0.1) {
          ctx.globalAlpha = alpha; ctx.fillStyle = night ? 'rgb(70,66,58)' : 'rgb(150,142,124)';
          ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(c.sx, c.sy); ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 1;
        }
        const [wx, wy] = F(0, fh * 1.06); glowPool(ctx, cam, wx, wy, entTop + h * 0.02, '255,206,140', 9, alpha * (night ? 0.6 : 0.4));
      }
      // 6) The drum — a round tower of clerestory windows rising behind the pediment.
      const drum1 = entTop + h * 0.5;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.60, entTop, drum1, stone, seed + 5, night, alpha, true);
      // 7) The verdigris copper dome — smooth stacked discs following a hemisphere profile.
      const domeH = h * 0.46, domeR = fh * 0.60, apex = drum1 + domeH;
      for (let i = 0; i <= 7; i++) {
        const t = i / 7, z = drum1 + domeH * t, r = domeR * Math.sqrt(Math.max(0, 1 - t * t));
        const pts = []; let ok = true;
        for (let k = 0; k <= 20; k++) { const ang = k / 20 * Math.PI * 2, p = cam.proj(dx + Math.cos(ang) * r, dy + Math.sin(ang) * r, z); if (p.f <= 0.08) { ok = false; break; } pts.push(p); }
        if (!ok) continue;
        const sh = 0.72 + 0.28 * t, fill = `rgb(${Math.round(78 * sh)},${Math.round(138 * sh)},${Math.round(118 * sh)})`, dd = pts.reduce((s, p) => s + p.f, 0) / pts.length;
        emitFace(dd, () => { ctx.globalAlpha = alpha; ctx.fillStyle = fill; ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; });
      }
      // 8) Stone lantern + finial, and one amber aviation beacon on the very crown.
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.12, apex, apex + h * 0.14, colPal, seed + 6, night, alpha, false);
      blinkLight(ctx, cam, dx, dy, apex + h * 0.18, '255,196,120', now, seed, alpha, 2);
      // 9) Night: floodlit columns from below + warm spill from the tall windows and the drum.
      if (night) {
        glowPool(ctx, cam, dx, dy, plinth + h * 0.04, '255,196,120', 24, alpha * 0.30);
        glowPool(ctx, cam, dx, dy, entTop + h * 0.2, '255,210,150', 14, alpha * 0.18);
      }
      break;
    }
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
      if (frontVis) {   // front-face signage — hidden when the marquee side is turned away
        marqueeBand(ctx, cam, dx, dy, E, fh, h * 0.27, neon, night, alpha);                           // marquee sign across the front
        const [nx, ny] = F(-fh * 0.55, fh * 0.55); neonBlade(ctx, cam, nx, ny, h * 0.3, h * 1.35, neon, night, alpha);
      }
      if (night) glowPool(ctx, cam, dx, dy, h * 1.4, '255,120,180', 20, alpha * 0.2);
      break;
    }
    case 'embassy': {   // Embassy Hotel & Bar: warm guest tower + big marquee (bar podium removed — it wasn't reading right)
      const neon = m.neon || '#ff4a9a';
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, 0, h * 1.55, pal, seed, night, alpha, true);                    // single warm ochre tower, ground to roof
      // ONE tall lit VERTICAL marquee — a solid triangular-prism blade planted at the building's FRONT-RIGHT
      // CORNER (local x≈+0.9, y just proud of the +0.98 front face), jutting FORWARD along the entrance
      // vector E so the blade stands in front of the building instead of running through the side wall.
      // EMBASSY stacked on BOTH slanted flat faces; per-face backface culling + the depth queue handle visibility.
      { const [nx, ny] = F(fh * 0.9, fh * 1.08); verticalMarquee(ctx, cam, nx, ny, h * 0.42, h * 1.5, 'EMBASSY', neon, night, alpha, E); }
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
      // Row of lit clone-vat cylinders standing OUTSIDE on the forecourt (ly beyond the ±1.18 front
      // face) — the science-y signature, no longer buried in the block now that occlusion is honest.
      for (const s of [-0.75, -0.25, 0.25, 0.75]) {
        const [vx, vy] = F(s * fh * 0.7, fh * 1.32);
        draw3DBoxAt(ctx, cam, vx, vy, fh * 0.13, 0, h * 0.52, 'ty_clone_vat', seed + 12 + Math.round(s * 4), night, alpha, true);
        glowPool(ctx, cam, vx, vy, h * 0.26, bio, 7, alpha * (night ? 0.55 : 0.34));      // green bio-glow in each tank
      }
      // Reactor / clean-room dome glow on the roof, venting steam, hazard beacon + antenna.
      glowPool(ctx, cam, dx, dy, h * 0.86, '120,255,220', 22, alpha * (night ? 0.42 : 0.24));
      { const [wx2, wy2] = F(fh * 0.72, -fh * 0.2); drawSmoke(ctx, cam, wx2, wy2, h * 0.8, '206,232,226', alpha * 0.6, now, seed + 2); }
      { const [mx, my] = F(-fh * 0.9, -fh * 0.2); mast(ctx, cam, mx, my, h * 0.8, h * 1.55, alpha, now, seed + 4); }
      blinkLight(ctx, cam, dx, dy, h * 1.15, bio, now, seed, alpha, 2);
      break;
    }
    case 'luxtower': {   // Halcyon Towers: a CAYAN-style helical glass slab — a slender square curtain-glass tower
      //                    with strong horizontal floor plates, twisting ~80° over its height to a chiselled crown.
      const neonA = '80,230,255', neonB = '255,90,180';   // cyan / magenta cyberpunk edge light
      const baseZ = h * 0.28, topZ = h * 2.7, N = 22;      // many thin floor-groups → a smooth continuous twist
      const twist = 1.4, fwBase = fh * 0.8;                // ~80° total helix + slender square footprint half-width
      const segZ = (i) => baseZ + (topZ - baseZ) * (i / N);
      const segW = (i) => fwBase * (1 - 0.44 * (i / N));   // gentle taper to a slender crown
      const segYaw = (i) => twist * (i / N);               // progressive rotation = the helix
      // 1) Lit lobby podium the tower rises out of (no street-overhanging entrance canopy).
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.3, 0, baseZ, pal, seed + 4, night, alpha, true);
      // 2) The helical glass slab — thin square curtain-glass boxes, each rotated a touch more than the last.
      //    Its ty_halcyon skin is the glass floor-plate texture (GLASS_WALL), so the twist reads as banded glass.
      for (let i = 0; i < N; i++) draw3DBoxAt(ctx, cam, dx, dy, segW(i), segZ(i), segZ(i + 1), pal, seed + i, night, alpha, i === N - 1, segYaw(i));
      // 3) Spiralling cyan/magenta light-runners — trace two opposite vertical corners up the twisting stack.
      for (const [dir, rgb] of [[[-1, -1], neonA], [[1, 1], neonB]]) {
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const w = segW(Math.min(i, N - 1)), ya = segYaw(i), cw = Math.cos(ya), sw = Math.sin(ya), lx = dir[0] * w, ly = dir[1] * w;
          const p = cam.proj(dx + lx * cw - ly * sw, dy + lx * sw + ly * cw, segZ(i));
          if (p.f > 0.12) pts.push(p);
        }
        if (pts.length > 1) emitFace(decoDepth(...pts.map(p => p.f)), () => {
          ctx.save(); ctx.globalAlpha = alpha * (night ? 0.95 : 0.55);
          ctx.strokeStyle = `rgba(${rgb},0.9)`; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
          if (night) { ctx.shadowColor = `rgb(${rgb})`; ctx.shadowBlur = 8; }
          ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.stroke();
          ctx.shadowBlur = 0; ctx.restore();
        });
      }
      // 4) Chiselled crown — a short set-back box continuing the twist — + an antenna spire with a holo beacon.
      draw3DBoxAt(ctx, cam, dx, dy, segW(N) * 0.9, topZ, topZ + h * 0.2, pal, seed + 20, night, alpha, true, twist * 1.08);
      mast(ctx, cam, dx, dy, topZ + h * 0.2, topZ + h * 0.56, alpha, now, seed);
      if (night) {
        glowPool(ctx, cam, dx, dy, baseZ, '120,220,255', 24, alpha * 0.3);            // cool lobby wash
        glowPool(ctx, cam, dx, dy, baseZ + (topZ - baseZ) * 0.5, neonA, 14, alpha * 0.22);   // mid sky-lobby glow
        glowPool(ctx, cam, dx, dy, topZ + h * 0.08, neonB, 16, alpha * 0.3);          // crown halo
      }
      blinkLight(ctx, cam, dx, dy, topZ + h * 0.56, neonA, now, seed, alpha, 2);      // cyan beacon on the spire
      break;
    }
    case 'solenne': {   // Solenne Residences: an opulent champagne-glass residential spire — three graceful
      //                  setback tiers narrowing to a glowing rooftop sky-pool band + a lantern crown.
      //                  WARM gold light-runners + a gentle quarter-turn — deliberately luxe/warm where
      //                  Halcyon is cold and angular, and taller, so the two read as rival landmarks.
      const gold = '255,206,120', warm = '255,232,190';
      const baseZ = h * 0.30, topZ = h * 3.05, N = 24;         // taller than Halcyon; many thin glass plates
      const twist = 0.52, fwBase = fh * 0.86;                  // ~30° gentle turn (elegant, not a helix)
      const segZ = (i) => baseZ + (topZ - baseZ) * (i / N);
      // Three setback tiers: the footprint steps in at ~1/3 and ~2/3 height, tapering within each tier.
      const tierW = (t) => t < 0.34 ? fwBase * (1 - 0.10 * (t / 0.34))
        : t < 0.68 ? fwBase * 0.80 * (1 - 0.12 * ((t - 0.34) / 0.34))
        : fwBase * 0.62 * (1 - 0.18 * ((t - 0.68) / 0.32));
      const segW = (i) => tierW(i / N);
      const segYaw = (i) => twist * (i / N);
      // 1) Lit stone podium the tower rises from (no street-overhanging entrance canopy).
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.34, 0, baseZ, pal, seed + 4, night, alpha, true);
      // 2) The champagne-glass shaft — thin plates, gentle quarter-turn, stepping inward at each tier.
      for (let i = 0; i < N; i++) draw3DBoxAt(ctx, cam, dx, dy, segW(i), segZ(i), segZ(i + 1), pal, seed + i, night, alpha, i === N - 1, segYaw(i));
      // 3) Warm gold light-runners tracing two opposite corners up the tapering stack.
      for (const dir of [[-1, -1], [1, 1]]) {
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const w = segW(Math.min(i, N - 1)), ya = segYaw(i), cw = Math.cos(ya), sw = Math.sin(ya), lx = dir[0] * w, ly = dir[1] * w;
          const p = cam.proj(dx + lx * cw - ly * sw, dy + lx * sw + ly * cw, segZ(i));
          if (p.f > 0.12) pts.push(p);
        }
        if (pts.length > 1) emitFace(decoDepth(...pts.map(p => p.f)), () => {
          ctx.save(); ctx.globalAlpha = alpha * (night ? 0.92 : 0.5);
          ctx.strokeStyle = `rgba(${gold},0.9)`; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
          if (night) { ctx.shadowColor = `rgb(${gold})`; ctx.shadowBlur = 8; }
          ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.stroke();
          ctx.shadowBlur = 0; ctx.restore();
        });
      }
      // 4) The glowing rooftop SKY-DECK POOL band just below the crown — a bright warm ring + a soft wash.
      { const z = segZ(N) - h * 0.06, r = segW(N - 1) * 1.08;
        drawRing(ctx, cam, dx, dy, z, r, 16, `rgba(${warm},${night ? 0.95 : 0.52})`, 2.2, alpha);
        if (night) glowPool(ctx, cam, dx, dy, z, gold, 15, alpha * 0.3); }
      // 5) Lantern crown — a short bright set-back box continuing the turn — + an antenna spire + warm beacon.
      draw3DBoxAt(ctx, cam, dx, dy, segW(N) * 0.86, topZ, topZ + h * 0.26, pal, seed + 20, night, alpha, true, twist);
      mast(ctx, cam, dx, dy, topZ + h * 0.26, topZ + h * 0.6, alpha, now, seed);
      if (night) {
        glowPool(ctx, cam, dx, dy, baseZ, warm, 22, alpha * 0.3);                     // warm lobby wash
        glowPool(ctx, cam, dx, dy, baseZ + (topZ - baseZ) * 0.5, gold, 13, alpha * 0.2);  // mid sky-lobby glow
        glowPool(ctx, cam, dx, dy, topZ + h * 0.1, gold, 16, alpha * 0.32);            // crown halo
      }
      blinkLight(ctx, cam, dx, dy, topZ + h * 0.6, gold, now, seed, alpha, 2);         // warm gold beacon on the spire
      break;
    }
    case 'chrome': {   // Chrome Court: a HIGH-TECH mirror-steel obelisk — a smooth tapered faceted chrome monolith
      //                 ringed by glowing cyan LED tech-bands, a brighter set-back sky-lounge halo + a beacon spire.
      //                 Deliberately ROUNDED where Halcyon is an angular twisting slab, so the two read as siblings.
      const led = '90,220,255';                              // cyan LED tech accent
      const NF = 10, baseZ = h * 0.22, topZ = h * 2.35;      // decagon: smooth but faceted; slightly shorter than Halcyon
      const rB = fh * 0.88, rShaftB = rB * 0.94, rT = fh * 0.4;   // wide base tapering to a slim crown
      const steelBase = WALL_COL[pal] || [118, 126, 136];    // ty_chrome
      const rAt = (t) => rShaftB + (rT - rShaftB) * t;       // shaft radius at height-fraction t
      // Procedural MIRROR-STEEL skin: a vertical gradient reflecting the sky up top, a dark polished
      // steel mid, and a brighter ground sheen low — modulated per facet by the key light (f.nl).
      const mirror = (f, tp, bt) => {
        const g = ctx.createLinearGradient(0, tp, 0, bt), s = 0.45 + f.nl * 0.6;
        if (night) {
          g.addColorStop(0, `rgba(${72 * s | 0},${96 * s | 0},${122 * s | 0},0.97)`);   // cool night sky on the steel
          g.addColorStop(0.5, `rgba(${38 * s | 0},${48 * s | 0},${60 * s | 0},0.97)`);
          g.addColorStop(1, `rgba(${58 * s | 0},${70 * s | 0},${84 * s | 0},0.97)`);     // city glow reflected low
        } else {
          g.addColorStop(0, `rgba(${182 + f.nl * 48 | 0},${202 + f.nl * 38 | 0},226,0.97)`);   // bright sky mirror
          g.addColorStop(0.44, `rgba(${steelBase[0] * s | 0},${steelBase[1] * s | 0},${steelBase[2] * s | 0},0.97)`);
          g.addColorStop(1, `rgba(${150 + f.nl * 40 | 0},${164 + f.nl * 34 | 0},178,0.97)`);   // ground sheen
        }
        return g;
      };
      const capCol = night ? 'rgba(46,58,72,0.97)' : 'rgba(178,196,216,0.97)';
      // 1) Splayed plinth (no street-overhanging entrance canopy).
      drawFacetDrum(ctx, cam, dx, dy, 0, baseZ, rB * 1.06, rB * 0.96, NF, alpha, mirror, capCol);
      // 2) The tapered chrome shaft — one smooth mirror-steel frustum (cone), no window grid.
      drawFacetDrum(ctx, cam, dx, dy, baseZ, topZ, rShaftB, rT, NF, alpha, mirror, null);
      // 3) Glowing horizontal LED tech-bands hugging the shaft at regular tech-floors.
      for (const t of [0.14, 0.3, 0.46, 0.78]) {
        const z = baseZ + (topZ - baseZ) * t;
        drawRing(ctx, cam, dx, dy, z, rAt(t) * 1.015, NF, `rgba(${led},${night ? 0.85 : 0.42})`, 1.6, alpha);
      }
      // 4) Brighter set-back SKY-LOUNGE halo band ~0.6 up — a double ring + a soft glow.
      { const t = 0.6, z = baseZ + (topZ - baseZ) * t, r = rAt(t) * 1.05;
        drawRing(ctx, cam, dx, dy, z, r, NF, `rgba(200,240,255,${night ? 0.95 : 0.5})`, 2.4, alpha);
        drawRing(ctx, cam, dx, dy, z + h * 0.06, r, NF, `rgba(${led},${night ? 0.8 : 0.4})`, 1.4, alpha);
        if (night) glowPool(ctx, cam, dx, dy, z, led, 16, alpha * 0.3); }
      // 5) Slim crown drum (capped) + halo ring + antenna spire with a holo beacon.
      drawFacetDrum(ctx, cam, dx, dy, topZ, topZ + h * 0.22, rT * 1.08, rT * 0.52, NF, alpha, mirror, capCol);
      drawRing(ctx, cam, dx, dy, topZ + h * 0.02, rT * 1.14, NF, `rgba(${led},${night ? 0.9 : 0.45})`, 1.8, alpha);
      mast(ctx, cam, dx, dy, topZ + h * 0.22, topZ + h * 0.58, alpha, now, seed);
      glowPool(ctx, cam, dx, dy, topZ * 0.5, '198,214,230', 20, alpha * (night ? 0.3 : 0.16));   // cold chrome sheen up the face
      if (night) { glowPool(ctx, cam, dx, dy, baseZ, '150,200,240', 22, alpha * 0.28); glowPool(ctx, cam, dx, dy, topZ + h * 0.08, led, 14, alpha * 0.3); }
      blinkLight(ctx, cam, dx, dy, topZ + h * 0.58, led, now, seed, alpha, 2);
      break;
    }
    case 'meridian': {   // The Meridian: a VINTAGE ART-DECO residential landmark — a stepped buff-limestone
      //                 ziggurat with a bespoke reeded-window skin (see DECO_WALL), a grand glazed-bronze
      //                 street entrance under a gilt nameplate, corner pilasters + gargoyles up the shaft, a
      //                 finned deco coronet, and a stone lantern under a verdigris copper cupola. No neon.
      const trim = 'ty_archive_col', bronze = 'ty_meridian_bronze';                                     // warm limestone trim + dark bronze entrance metal
      const zPod = h * 0.24, zShaft = h * 1.04, zSet1 = h * 1.52, zSet2 = h * 1.86, zCrown = h * 2.06;
      // 1) Stepped lobby podium, capped by a broad projecting cornice ledge.
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.34, 0, zPod, pal, seed + 5, night, alpha, true);              // podium
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.40, zPod, zPod + h * 0.045, trim, seed + 6, night, alpha, true);   // base cornice band
      // 1b) GRAND BRONZE STREET ENTRANCE on the frontage (E): a tall glazed-bronze portal in a fluted stone
      //     surround, a projecting marquee canopy over the sidewalk, and flanking amber torchère pylons. The
      //     front-centre pilaster (§3) is skipped so the bay reads clear between the corner piers.
      { const [ex, ey] = F(0, fh * 1.30); draw3DBoxAt(ctx, cam, ex, ey, fh * 0.30, 0, zPod + h * 0.02, bronze, seed + 40, night, alpha, false); }   // glazed bronze doors / lobby
      for (const s of [-1, 1]) { const [jx, jy] = F(s * fh * 0.34, fh * 1.34); draw3DBoxAt(ctx, cam, jx, jy, fh * 0.055, 0, zPod + h * 0.06, trim, seed + 41 + s, night, alpha, true); }   // fluted stone jambs framing the doors
      { const [cx, cy] = F(0, fh * 1.42); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.34, zPod + h * 0.02, zPod + h * 0.05, bronze, seed + 44, night, alpha, true); }   // projecting bronze marquee canopy over the sidewalk
      for (const s of [-1, 1]) { const [tx, ty] = F(s * fh * 0.5, fh * 1.5); draw3DBoxAt(ctx, cam, tx, ty, fh * 0.05, 0, zPod, trim, seed + 45 + s, night, alpha, true); glowPool(ctx, cam, tx, ty, zPod + h * 0.01, '255,190,110', 6, alpha * (night ? 0.5 : 0.26)); }   // torchère pylons + steady amber lamp
      // 2) Main shaft.
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, zPod + h * 0.045, zShaft, pal, seed, night, alpha, true);
      // 2b) Gilt "THE MERIDIAN" engraved on a stone frieze band over the entrance — surface text, never billboarded.
      { const friZ0 = zPod + h * 0.07, friZ1 = zPod + h * 0.17;
        draw3DBoxAt(ctx, cam, dx, dy, fh * 1.10, friZ0, friZ1, trim, seed + 46, night, alpha, false);    // stone frieze band on the lower shaft
        if (frontVis) {
          const nhw = fh * 0.66, [nlx, nly] = F(-nhw, fh * 1.11), [nrx, nry] = F(nhw, fh * 1.11);
          const TL = cam.proj(nlx, nly, friZ1 - h * 0.012), TR = cam.proj(nrx, nry, friZ1 - h * 0.012), BR = cam.proj(nrx, nry, friZ0 + h * 0.012), BL = cam.proj(nlx, nly, friZ0 + h * 0.012);
          if ([TL, TR, BR, BL].every(p => p.f > 0.12)) { const nam = bakeSignText('THE MERIDIAN', '#e8c878', night ? 1 : 0, false); emitFace(decoDepth(TL.f, TR.f, BR.f, BL.f), () => drawSurfaceText(ctx, TL, TR, BR, BL, nam, false, alpha)); }
        } }
      // 3) Vertical pilaster ribs standing proud of the shaft — corners + mid-face (front-centre skipped for the
      //    entrance bay), so the deco piers read from any camera angle (each box is backface-culled per face).
      for (const [sx, sy] of [[-1,-1],[1,-1],[1,1],[-1,1],[0,-1],[1,0],[-1,0]]) {
        const [px, py] = F(sx * fh * 1.02, sy * fh * 1.02);
        draw3DBoxAt(ctx, cam, px, py, fh * (sx && sy ? 0.13 : 0.10), zPod, zShaft + h * 0.04, trim, seed + 20 + sx * 3 + sy, night, alpha, false);
      }
      // 4) Shaft cornice ledge → first setback tier.
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.13, zShaft, zShaft + h * 0.045, trim, seed + 7, night, alpha, true);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.82, zShaft + h * 0.045, zSet1, pal, seed + 1, night, alpha, true);
      // 5) Second cornice → upper setback tier.
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.89, zSet1, zSet1 + h * 0.04, trim, seed + 8, night, alpha, true);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.58, zSet1 + h * 0.04, zSet2, pal, seed + 2, night, alpha, true);
      // 6) Crown cornice → set-back penthouse block, ringed by a finned DECO CORONET: vertical limestone fins
      //    stepping proud of the parapet (corners peaking highest) — the crown that reads best from the air.
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.64, zSet2, zSet2 + h * 0.035, trim, seed + 9, night, alpha, true);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.40, zSet2 + h * 0.035, zCrown, pal, seed + 3, night, alpha, true);
      for (const [sx, sy] of [[-1,-1],[1,-1],[1,1],[-1,1],[0,-1],[1,0],[0,1],[-1,0]]) {
        const [fx, fy] = F(sx * fh * 0.42, sy * fh * 0.42);
        draw3DBoxAt(ctx, cam, fx, fy, fh * (sx && sy ? 0.06 : 0.05), zSet2 + h * 0.02, zCrown + h * (sx && sy ? 0.11 : 0.06), trim, seed + 50 + sx * 3 + sy, night, alpha, true);
      }
      // 7) Ornamental octagonal stone lantern + a verdigris copper OGEE cupola + a finial with a lonely
      //    amber beacon — the vintage crown that replaces the old rooftop water tank.
      const lantZ0 = zCrown, lantZ1 = zCrown + h * 0.16, lantR = fh * 0.26;
      const stoneRGB = WALL_COL[trim] || [150, 142, 124];
      const lantStyle = (f) => { const s = (night ? 0.44 : 0.78) + f.nl * 0.5; return `rgba(${stoneRGB[0]*s|0},${stoneRGB[1]*s|0},${stoneRGB[2]*s|0},0.97)`; };
      drawFacetDrum(ctx, cam, dx, dy, lantZ0, lantZ1, lantR * 1.04, lantR, 8, alpha, lantStyle, null);
      const cupH = h * 0.30, cupR = lantR * 1.12, apex = lantZ1 + cupH;
      for (let i = 0; i <= 8; i++) {
        const t = i / 8, z = lantZ1 + cupH * t, r = cupR * Math.pow(Math.max(0, 1 - t * t), 0.7);       // ogee (pointed) copper cap
        const pts = []; let ok = true;
        for (let k = 0; k <= 18; k++) { const ang = k / 18 * Math.PI * 2, p = cam.proj(dx + Math.cos(ang) * r, dy + Math.sin(ang) * r, z); if (p.f <= 0.08) { ok = false; break; } pts.push(p); }
        if (!ok) continue;
        // Depth = ring-centre f MINUS a height bias. A symmetric ring's average f collapses to the tile
        // centre's value, so all 9 discs would tie and z-fight (the same blink as the stepped ledges); the
        // -z*0.02 lift makes the higher disc (nearer the down-looking cam) sort reliably on top.
        const sh = 0.68 + 0.32 * t, fill = `rgb(${Math.round(78 * sh)},${Math.round(138 * sh)},${Math.round(118 * sh)})`, dd = pts.reduce((s, p) => s + p.f, 0) / pts.length - z * 0.02;
        emitFace(dd, () => { ctx.globalAlpha = alpha; ctx.fillStyle = fill; ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; });
      }
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.05, apex, apex + h * 0.12, trim, seed + 4, night, alpha, false);   // stone finial
      blinkLight(ctx, cam, dx, dy, apex + h * 0.16, '255,196,120', now, seed, alpha, 1.8);
      // 8) FOUR high-poly stone gargoyles crouched at the main-shaft cornice corners, each craning out
      //    over the street on the outward diagonal — the grotesques that make it a vintage landmark.
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const [gx, gy] = F(sx * fh * 0.9, sy * fh * 0.9);
        drawGargoyle(ctx, cam, gx, gy, zShaft + h * 0.045, fh * 0.42, [gx - dx, gy - dy], alpha, night, seed + 30 + sx * 2 + sy);
      }
      if (night) {
        glowPool(ctx, cam, dx, dy, h * 0.9, '255,200,130', 14, alpha * 0.16);                            // scattered warm windows up the shaft
        glowPool(ctx, cam, dx, dy, zPod + h * 0.04, '255,206,140', 22, alpha * 0.24);                    // floodlit limestone base
        glowPool(ctx, cam, dx, dy, zPod * 0.5, '255,190,120', 12, alpha * 0.30);                         // warm spill from the lobby entrance
        glowPool(ctx, cam, dx, dy, apex, '150,220,190', 10, alpha * 0.16);                               // faint copper-crown wash
      }
      break;
    }
    case 'divebar': {   // Sump / The Dead Pigeon: low grimy box + one flickering neon blade + dim window glow
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.9, 0, h * 0.62, pal, seed, night, alpha, true);
      { const [nx, ny] = F(fh * 0.42, fh * 0.5); neonBlade(ctx, cam, nx, ny, h * 0.62, h * 0.98, m.neon || '#5fd0ff', night, alpha); }   // blade over the door
      { const [vx, vy] = F(-fh * 0.6, fh * 0.2); drawSmoke(ctx, cam, vx, vy, h * 0.62, '120,116,110', alpha * 0.4, now, seed + 3); }      // kitchen/vent smoke
      if (night) glowPool(ctx, cam, dx, dy, h * 0.28, '255,180,90', 10, alpha * 0.2);                   // grimy amber window
      if (m.perch) {   // The Dead Pigeon — its stuffed bird on a pole over the register
        const [px, py] = F(0, fh * 0.55);
        mast(ctx, cam, px, py, h * 0.62, h * 0.82, alpha, now, seed + 7);
        draw3DBoxAt(ctx, cam, px, py, fh * 0.08, h * 0.82, h * 0.9, 'ty_door', seed + 8, night, alpha, true);   // the pigeon silhouette
      }
      break;
    }
    case 'strip': {   // The Cherry Pit: dark box + twin neon roofline + a cherry-red stage glow bleeding out the door
      const neon = m.neon || '#ff4a9a';
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.05, 0, h * 0.8, pal, seed, night, alpha, true);
      { const [ax, ay] = F(-fh * 0.4, 0); neonBlade(ctx, cam, ax, ay, h * 0.8, h * 1.15, neon, night, alpha); }
      { const [bx, by] = F(fh * 0.4, 0); neonBlade(ctx, cam, bx, by, h * 0.8, h * 1.15, neon, night, alpha); }
      { const [gx, gy] = F(0, fh * 0.95); glowPool(ctx, cam, gx, gy, 0.02, '220,40,70', 16, alpha * (night ? 0.5 : 0.3)); }   // cherry-red spill out the entrance
      glowPool(ctx, cam, dx, dy, h * 0.85, '255,74,120', 20, alpha * (night ? 0.36 : 0.16));            // roofline wash
      break;
    }
    case 'grocery': {   // Ration Nine: neighbourhood store + a long front awning, stacked crates, and a lit sign
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.12, 0, h * 0.6, pal, seed, night, alpha, true);
      { const [ax, ay] = F(0, fh * 0.95); draw3DBoxAt(ctx, cam, ax, ay, fh * 1.06, h * 0.14, h * 0.28, 'ty_door', seed + 1, night, alpha, false); }   // full-width awning
      for (const s of [-0.7, 0.7]) { const [cx, cy] = F(s * fh * 0.7, fh * 0.82); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.22, 0, h * 0.14, 'ty_door', seed + 9 + s * 3, night, alpha, true); }   // crates out front
      neonBlade(ctx, cam, dx, dy, h * 0.55, h * 0.85, m.neon || '#ffcf3e', night, alpha);
      if (night) glowPool(ctx, cam, dx, dy, h * 0.26, '255,214,140', 12, alpha * 0.22);                 // lit aisles through the glass
      break;
    }
    case 'techstall': {   // Ampersand Electronics: a cluttered stall tucked under an overpass girder, strung with cyan tech-glow
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.1, 0, h * 0.5, pal, seed, night, alpha, true);               // stall box
      for (const s of [-1, 1]) { const [sx, sy] = F(s * fh * 1.05, -fh * 0.1); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.12, 0, h * 1.5, pal, seed + 2 + s, night, alpha, false); }   // overpass piers
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.4, h * 1.5, h * 1.68, pal, seed + 5, night, alpha, true);    // the girder deck overhead
      neonBlade(ctx, cam, dx, dy, h * 0.5, h * 0.82, m.neon || '#5fd0ff', night, alpha);
      glowPool(ctx, cam, dx, dy, h * 0.3, '95,208,255', 12, alpha * (night ? 0.4 : 0.22));              // cyan gear-glow spilling off the counter
      break;
    }
    case 'showroom': {   // Dead Space Interiors: a glazed showroom floor with a big lit display window
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.14, 0, h * 0.72, pal, seed, night, alpha, true);
      { const [wx4, wy4] = F(0, fh * 0.92); glowPool(ctx, cam, wx4, wy4, h * 0.28, '150,220,190', 20, alpha * (night ? 0.42 : 0.24)); }   // display-window glow
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.66, h * 0.72, h * 0.84, pal, seed + 1, night, alpha, true);   // slim parapet band
      neonBlade(ctx, cam, dx, dy, h * 0.7, h * 0.98, m.neon || '#7dff6a', night, alpha);
      break;
    }
    case 'boutique': {   // Second Skin: a narrow tall shopfront with a full-height neon fashion blade + warm display glow
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.8, 0, h * 0.98, pal, seed, night, alpha, true);
      { const [nx, ny] = F(fh * 0.6, fh * 0.5); neonBlade(ctx, cam, nx, ny, h * 0.28, h * 1.05, m.neon || '#ff4a9a', night, alpha); }
      if (night) glowPool(ctx, cam, dx, dy, h * 0.22, '255,150,200', 10, alpha * 0.28);                 // lit boutique window
      break;
    }
    case 'nightclub': {   // Voltage: a sleek near-black monolith split by a floor-to-roof blue-white name-arc, chasing crown bulbs, laser-blue wash
      const neon = m.neon || '#5cd6ff';
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, 0, h * 1.05, pal, seed, night, alpha, true);              // tall near-black slab
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.1, h * 1.05, h * 1.2, pal, seed + 1, night, alpha, true);     // parapet crown band
      { const [ax, ay] = F(0, fh * 0.98); neonBlade(ctx, cam, ax, ay, 0, h * 1.2, neon, night, alpha); } // the signature: the name struck floor-to-roof up the frontage like a live power line
      for (const s of [-0.62, -0.2, 0.2, 0.62]) { const [lx, ly] = F(s * fh, fh * 0.98); blinkLight(ctx, cam, lx, ly, h * 1.16, '92,214,255', now, seed + s * 11, alpha, 1.6); }   // chasing crown bulbs
      { const [gx, gy] = F(0, fh * 1.0); glowPool(ctx, cam, gx, gy, 0.02, '70,150,255', 18, alpha * (night ? 0.5 : 0.28)); }   // blue spill out the door
      glowPool(ctx, cam, dx, dy, h * 1.14, '92,150,255', 22, alpha * (night ? 0.42 : 0.2));              // laser-blue roofline wash
      break;
    }
    case 'atelier': {   // Aurelia: a narrow tall graphite-glass couture monolith — one slim violet name-blade, a bright lit cap, a single restrained vitrine glow
      const neon = m.neon || '#b070ff';
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.74, 0, h * 1.12, pal, seed, night, alpha, true);              // slender dark-glass shaft
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.8, h * 1.12, h * 1.2, pal, seed + 1, night, alpha, true);     // slim lit parapet cap
      { const [nx, ny] = F(fh * 0.5, fh * 0.6); neonBlade(ctx, cam, nx, ny, h * 0.2, h * 1.16, neon, night, alpha); }   // slim full-height violet name-blade by the door
      if (night) { const [wx, wy] = F(0, fh * 0.72); glowPool(ctx, cam, wx, wy, h * 0.5, '176,112,255', 9, alpha * 0.22); }   // one restrained violet vitrine glow
      break;
    }
    case 'junkshop': {   // Velk's Pre-Owned Furnishings: cluttered main shed + lean-to + junk stacked on the roof
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.15, 0, h * 0.6, pal, seed, night, alpha, true);              // main shed
      { const [lx, ly] = F(fh * 0.95, 0); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.5, 0, h * 0.4, pal, seed + 1, night, alpha, true); }   // lean-to annex
      for (const s of [-0.5, 0.1, 0.6]) { const [jx, jy] = F(s * fh * 0.9, -fh * 0.2); draw3DBoxAt(ctx, cam, jx, jy, fh * 0.18, h * 0.6, h * (0.68 + frac(seed + s * 7) * 0.12), 'ty_door', seed + 10 + s * 5, night, alpha, true); }   // roof junk piles
      neonBlade(ctx, cam, dx, dy, h * 0.6, h * 0.86, m.neon || '#ff8a4a', night, alpha);
      if (night) glowPool(ctx, cam, dx, dy, h * 0.26, '255,170,110', 10, alpha * 0.2);
      break;
    }
    case 'apartment': {   // residential block — podium + tall slab, stepped roofline, rooftop water tank & lift housing
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.12, 0, h * 0.2, pal, seed + 5, night, alpha, true);          // ground-floor podium
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, h * 0.2, h * 1.02, pal, seed, night, alpha, true);        // main residential slab
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.64, h * 1.02, h * 1.18, pal, seed + 4, night, alpha, true);   // set-back top floors → a stepped roofline
      if (m.penthouse) { const [px, py] = F(fh * 0.3, 0); draw3DBoxAt(ctx, cam, px, py, fh * 0.42, h * 1.18, h * 1.32, pal, seed + 2, night, alpha, true); }
      { const [tx, ty] = F(-fh * 0.34, -fh * 0.22); draw3DBoxAt(ctx, cam, tx, ty, fh * 0.16, h * 1.18, h * 1.34, 'ty_door', seed + 6, night, alpha, true); }   // rooftop water tank on stilts
      { const [cx, cy] = F(fh * 0.3, fh * 0.12); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.2, h * 1.18, h * 1.25, 'ty_door', seed + 7, night, alpha, true); }         // lift/AC housing
      if (night) glowPool(ctx, cam, dx, dy, h * 0.6, '255,206,140', 10, alpha * 0.12);                   // scattered lit windows
      break;
    }
    case 'police': {   // civic block + set-back roof house + blue beacon + antenna
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.14, 0, h * 0.85, pal, seed, night, alpha, true);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.62, h * 0.85, h * 1.02, pal, seed + 1, night, alpha, true);
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
    case 'ksabstudio': {   // KSAB-9 broadcast plant — a professional TV studio: a windowless ribbed sound stage under a
      // SAWTOOTH north-light roof (glazed monitor triangles), a faceted curtain-glass lobby with an angled entrance
      // visor, a triangular broadcast LATTICE tower + uplink dishes, and a self-occluding KSAB marquee. Every faceted
      // piece rides the shared face queue (emitFlat / draw3DBoxAt), so the mass and neighbours occlude it correctly —
      // signage is a marqueeBand (tiny 0.06 lift), never a DECO_LIFT-ed blade that would bleed through the building.
      const KSABc = m.neon || '#b98cff';
      const L = (lx, ly, z) => { const w = facePt(dx, dy, lx, ly, E); return [w[0], w[1], z]; };
      const [cx, cy] = F(0, -fh * 0.18);                      // stage-mass centre, set back off the street
      const mh = h * 1.05, mhx = fh * 0.7;                    // mass top height + footprint half
      // 1) Main sound stage — a monolithic WINDOWLESS ribbed clear-span volume (flat cap so the roof never shows through).
      draw3DBoxAt(ctx, cam, cx, cy, mhx, 0, mh, pal, seed, night, alpha, true);
      // 2) Sawtooth north-light roof monitors — the glazed saw of triangles that reads instantly as a sound stage.
      const roofc = night ? 'rgba(40,35,54,0.97)' : 'rgba(54,48,72,0.97)';
      const glassc = night ? 'rgba(152,120,222,0.82)' : 'rgba(160,188,216,0.9)';
      const edge = 'rgba(18,14,24,0.55)';
      sawtoothRoof(ctx, cam, cx, cy, E, mhx * 0.92, mhx * 0.88, mh, h * 0.17, 5, roofc, glassc, edge, alpha);
      // 3) Fly tower / lighting-grid loft — a taller ribbed box over the rear third, breaking above the saw.
      { const [tx, ty] = F(-fh * 0.14, -fh * 0.46); draw3DBoxAt(ctx, cam, tx, ty, fh * 0.32, mh, h * 1.44, pal, seed + 1, night, alpha, true); }
      // 4) Triangular broadcast LATTICE tower on the rear roof — legs + X-braced belts + a mid-mast uplink drum + beacon.
      { const [lx, ly] = F(fh * 0.36, -fh * 0.4); latticeTower(ctx, cam, lx, ly, mh, h * 2.7, fh * 0.15, fh * 0.045, alpha, now, seed + 5);
        dish(ctx, cam, lx, ly, mh + h * 0.9, 8, alpha); }
      // 5) Rooftop kit — an HVAC/chiller block + a satellite uplink dish among the monitors.
      { const [hx, hy] = F(fh * 0.42, fh * 0.04); draw3DBoxAt(ctx, cam, hx, hy, fh * 0.16, mh, mh + h * 0.15, 'ty_door', seed + 6, night, alpha, true); }
      { const [ex, ey] = F(-fh * 0.46, -fh * 0.02); dish(ctx, cam, ex, ey, mh + h * 0.05, 10, alpha); }
      // 6) Faceted curtain-glass production-office lobby across the front — real glass (ty_ksab_glass ∈ GLASS_WALL), inside the tile.
      const [ox, oy] = F(0, fh * 0.6); const lobH = h * 0.44, lhx = fh * 0.34;
      draw3DBoxAt(ctx, cam, ox, oy, lhx, 0, lobH, 'ty_ksab_glass', seed + 3, night, alpha, true);
      // 6b) Angled glass entrance VISOR — a thin cantilevered canopy sloping out to the tile edge (never past), with triangular side brackets.
      { const zin = lobH * 0.9, zout = lobH * 0.74, lip = h * 0.05, gx = fh * 0.3;
        const glassV = night ? 'rgba(150,120,220,0.7)' : 'rgba(168,196,222,0.82)';
        emitFlat(ctx, cam, [L(-gx, fh * 0.82, zin), L(gx, fh * 0.82, zin), L(gx, fh * 0.98, zout), L(-gx, fh * 0.98, zout)], glassV, alpha, { stroke: edge, lw: 1 });                                            // visor surface (top-facing)
        emitFlat(ctx, cam, [L(-gx, fh * 0.98, zout), L(gx, fh * 0.98, zout), L(gx, fh * 0.98, zout - lip), L(-gx, fh * 0.98, zout - lip)], roofc, alpha, { stroke: edge, lw: 1, cullN: [E[0], E[1]] });          // front fascia lip
        for (const s of [-1, 1]) emitFlat(ctx, cam, [L(s * gx, fh * 0.82, zin), L(s * gx, fh * 0.98, zout), L(s * gx, fh * 0.98, zout - lip)], roofc, alpha, { cullN: [s * E[1], -s * E[0]] });                   // triangular side brackets
      }
      // 7) KSAB marquee across the lobby front — self-occluding band (no through-building bleed), plus warm lobby wash.
      marqueeBand(ctx, cam, ox, oy, E, lhx, lobH + h * 0.05, KSABc, night, alpha, 'KSAB');
      if (night) { glowPool(ctx, cam, ox, oy, lobH * 0.5, '150,120,220', 12, alpha * 0.26); glowPool(ctx, cam, cx, cy, mh, '150,120,220', 16, alpha * 0.14); }
      break;
    }
    case 'studio': {   // KSAB TV studio LOT: a barrel-vaulted hero sound stage (windowless ribbed shell + elephant door), a second scene-dock stage, a glazed production-office public front, broadcast mast + uplink dishes, and the iconic back-lot water tower — a complex, unmistakably-studio composition, all kept inside the tile
      const KSAB = m.neon || '#b98cff';
      const sfw = fh * 0.6, wallTop = h * 0.82, archH = sfw * 0.6;                                          // hero-stage half-width, eaves height, barrel-vault rise (fh-scaled, like the diner/warehouse sheds)
      const stageBase = [92, 80, 118];                                                                      // violet-grey roof/tank base tying the lot to the ty_ksab palette
      const metal = (r, g, b) => (f) => { const s = 0.5 + f.nl * 0.5; return `rgb(${r * s | 0},${g * s | 0},${b * s | 0})`; };
      // ── Hero sound stage — a big WINDOWLESS ribbed clear-span shell (ty_ksab ∈ METAL_WALL) under a curved barrel vault, arched gable facing the street ──
      { const [sx, sy] = F(-fh * 0.05, 0); draw3DBoxAt(ctx, cam, sx, sy, sfw, 0, wallTop, pal, seed, night, alpha, false); }   // roof left open for the barrel
      drawBarrelRoof(ctx, cam, F, -fh * 0.05, sfw, sfw * 0.94, wallTop, archH, 12, alpha, stageBase);
      // ── Fly tower / lighting-grid loft breaking the ridge at the rear ──
      { const [tx, ty] = F(-fh * 0.05, -sfw * 0.5); draw3DBoxAt(ctx, cam, tx, ty, fh * 0.26, wallTop, wallTop + h * 0.5, pal, seed + 1, night, alpha, true); }
      // ── Elephant door: the huge roll-up scenery door on the front gable (only when that face is toward us) ──
      if (frontVis) { const [gx, gy] = F(-fh * 0.05, sfw * 0.99); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.3, 0, h * 0.52, 'ty_door', seed + 2, night, alpha, false); }
      // ── Second stage / scene dock — a lower windowless box to the right with a rooftop HVAC plenum ──
      { const [d2x, d2y] = F(fh * 0.56, -fh * 0.32); draw3DBoxAt(ctx, cam, d2x, d2y, fh * 0.32, 0, h * 0.62, pal, seed + 3, night, alpha, true);
        draw3DBoxAt(ctx, cam, d2x, d2y, fh * 0.2, h * 0.62, h * 0.74, 'ty_door', seed + 4, night, alpha, true); }
      // ── Low glazed production-office wing across the front-right — real curtain glass (ty_ksab_glass ∈ GLASS_WALL), a lit KSAB marquee, warm-lit lobby ──
      { const [ox, oy] = F(fh * 0.4, sfw * 0.62); draw3DBoxAt(ctx, cam, ox, oy, fh * 0.42, 0, h * 0.46, 'ty_ksab_glass', seed + 5, night, alpha, true);
        marqueeBand(ctx, cam, ox, oy, E, fh * 0.44, h * 0.34, KSAB, night, alpha, 'KSAB');
        if (night) glowPool(ctx, cam, ox, oy, h * 0.2, '255,210,150', 12, alpha * 0.24); }
      // ── Broadcast kit — transmitter mast + red beacon on the fly tower, two satellite uplink dishes on the scene-dock roof ──
      { const [mx, my] = F(-fh * 0.05, -sfw * 0.5); mast(ctx, cam, mx, my, wallTop + h * 0.5, wallTop + h * 1.9, alpha, now, seed + 6); }
      { const [e1x, e1y] = F(fh * 0.46, -fh * 0.16); dish(ctx, cam, e1x, e1y, h * 0.62, 9, alpha); }
      { const [e2x, e2y] = F(fh * 0.66, -fh * 0.46); dish(ctx, cam, e2x, e2y, h * 0.62, 8, alpha); }
      // ── The iconic back-lot water tower — a squat tank on four tall spindly legs ──
      { const tcx = -fh * 0.6, tcy = -fh * 0.52, legTop = h * 0.7, [wx, wy] = F(tcx, tcy);
        for (const s of [-1, 1]) for (const t of [-1, 1]) { const [lx, ly] = F(tcx + s * fh * 0.1, tcy + t * fh * 0.1); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.03, 0, legTop, 'ty_door', seed + 8 + s + t * 2, night, alpha, false); }
        drawFacetDrum(ctx, cam, wx, wy, legTop, legTop + h * 0.26, fh * 0.16, fh * 0.16, 10, alpha, metal(stageBase[0], stageBase[1], stageBase[2]), 'rgb(70,60,92)');
        drawFacetDrum(ctx, cam, wx, wy, legTop + h * 0.26, legTop + h * 0.36, fh * 0.16, fh * 0.02, 10, alpha, metal(78, 68, 100), null); }   // conical cap
      // ── KSAB call-letter blade on the hero-stage crown ──
      { const [bx, by] = F(fh * 0.32, -sfw * 0.2); neonBlade(ctx, cam, bx, by, wallTop + archH, wallTop + archH + h * 0.6, KSAB, night, alpha, 'KSAB'); }
      // ── Night washes — violet KSAB roofline + a cool key-light glow off the stage front ──
      if (night) { glowPool(ctx, cam, dx, dy, h * 0.6, '150,120,220', 16, alpha * 0.22);
        const [kx, ky] = F(-fh * 0.05, sfw * 0.6); glowPool(ctx, cam, kx, ky, h * 0.3, '190,200,255', 12, alpha * 0.16); }
      break;
    }
    case 'studiogate': {   // KSAB Writers' Wing: a glazed office annex with a violet KSAB parapet + a steady lit marquee. Deliberately simple and ENTIRELY within its own tile (no cantilevered canopy/turnstiles — those spilled onto the road). Reads low once flags.floors:2 reaches the DB.
      // Curtain-glass lobby — real glazed skin (ty_ksab_glass ∈ GLASS_WALL: sky sheen, no window grid).
      // No roof cap: the wider parapet below caps the footprint at h*0.9, so a lobby cap here would only
      // z-fight the parapet's own roof (near-identical queue depth → the roof strobed dark↔light purple).
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, 0, h * 0.9, 'ty_ksab_glass', seed, night, alpha, false);
      // Violet KSAB parapet cap tying it to the studio's palette.
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, h * 0.9, h * 1.02, pal, seed + 1, night, alpha, true);
      // Steady lit marquee across the front — KSAB. Always drawn (the depth queue occludes it when the
      // front faces away), so it no longer flashes on/off as the camera swings past the facing threshold.
      marqueeBand(ctx, cam, dx, dy, E, fh * 0.82, h * 0.6, m.neon || '#b98cff', night, alpha, 'KSAB');
      // A KSAB call-letter blade set on the roof (back corner, inside the footprint).
      { const [bx, by] = F(-fh * 0.5, -fh * 0.42); neonBlade(ctx, cam, bx, by, h * 1.02, h * 1.34, m.neon || '#b98cff', night, alpha); }
      if (night) glowPool(ctx, cam, dx, dy, h * 0.4, '150,120,220', 12, alpha * 0.24);   // violet marquee wash
      break;
    }
    case 'buzzard': {   // BUZZARD FIELD (The Reach) — a patched-steel smuggler's hangar on a cracked
      // strip: a sagging corrugated shed with an open bay, a stilted spotter's shack, a dead-still
      // windsock, a hand-lettered board, scattered salvage, and a lone buzzard on the ridge.
      const P = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); };
      const wallTop = h * 0.6, hw = fh * 0.86, archH = hw * 0.4;
      // 1) The shed — corrugated patched-steel walls under a low rusted tin barrel roof.
      draw3DBoxAt(ctx, cam, dx, dy, hw, 0, wallTop, 'ty_reach_hangar', seed, night, alpha, false);
      drawBarrelRoof(ctx, cam, F, 0, hw, hw * 0.94, wallTop, archH, 9, alpha, [120, 92, 66]);
      { const [px, py] = F(-hw * 0.52, -hw * 0.1); draw3DBoxAt(ctx, cam, px, py, hw * 0.26, wallTop * 0.18, wallTop * 0.86, 'ty_reach_rust', seed + 3, night, alpha, false); }   // riveted rust plate slapped over a corner
      // 2) OPEN BAY on the entrance (+y) gable — a dark recessed interior + a parked-craft tail hint.
      if (frontVis) {
        const odw = hw * 0.56, oTop = wallTop * 0.84, inset = hw * 0.6;
        const o = [P(-odw, hw + 0.003, 0), P(odw, hw + 0.003, 0), P(odw, hw + 0.003, oTop), P(-odw, hw + 0.003, oTop)];
        if (o.every(p => p.f > 0.1)) emitFace(o.reduce((s, p) => s + p.f, 0) / 4 - 0.002, () => {
          const trace = (pp) => { ctx.beginPath(); pp.forEach((p, i) => i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.closePath(); };
          ctx.globalAlpha = alpha;
          ctx.fillStyle = night ? 'rgba(44,36,26,0.96)' : 'rgba(14,15,18,0.97)'; trace(o); ctx.fill();
          const bk = [P(-odw * 0.86, hw - inset, 0), P(odw * 0.86, hw - inset, 0), P(odw * 0.86, hw - inset, oTop * 0.9), P(-odw * 0.86, hw - inset, oTop * 0.9)];
          if (bk.every(p => p.f > 0.1)) { ctx.fillStyle = night ? 'rgba(66,52,34,0.95)' : 'rgba(26,27,30,0.96)'; trace(bk); ctx.fill(); }   // recessed back wall
          const fl = [P(-odw, hw + 0.003, 0.006), P(odw, hw + 0.003, 0.006), P(odw * 0.86, hw - inset, 0.006), P(-odw * 0.86, hw - inset, 0.006)];
          if (fl.every(p => p.f > 0.1)) { ctx.fillStyle = 'rgba(40,40,44,0.9)'; trace(fl); ctx.fill(); }   // oil-stained floor
          const tb = P(odw * 0.2, hw - inset * 0.7, 0.01), tt = P(odw * 0.2, hw - inset * 0.7, oTop * 0.66), tn = P(-odw * 0.36, hw - inset * 0.55, oTop * 0.24);
          if ([tb, tt, tn].every(p => p.f > 0.1)) { ctx.fillStyle = 'rgba(118,110,96,0.5)'; ctx.beginPath(); ctx.moveTo(tb.sx, tb.sy); ctx.lineTo(tt.sx, tt.sy); ctx.lineTo(tn.sx, tn.sy); ctx.closePath(); ctx.fill(); }   // parked-craft tail
          ctx.strokeStyle = 'rgba(8,8,10,0.9)'; ctx.lineWidth = 1.4; trace(o); ctx.stroke();
          ctx.globalAlpha = 1;
        });
        // hand-lettered NO MANIFESTS board bolted beside the bay (surface text on the gable)
        { const bz0 = oTop + wallTop * 0.02, bz1 = oTop + wallTop * 0.16, bhw = hw * 0.5;
          const TL = P(-bhw, hw + 0.006, bz1), TR = P(bhw, hw + 0.006, bz1), BR = P(bhw, hw + 0.006, bz0), BL = P(-bhw, hw + 0.006, bz0);
          if ([TL, TR, BR, BL].every(p => p.f > 0.12)) { const tex = bakeSignText('BUZZARD FIELD', '#e8c25a', night ? 1 : 0, false); emitFace(decoDepth(TL.f, TR.f, BR.f, BL.f), () => drawSurfaceText(ctx, TL, TR, BR, BL, tex, false, alpha)); } }
        if (night) { const [obx, oby] = F(0, hw); glowPool(ctx, cam, obx, oby, wallTop * 0.3, '255,200,132', 13, alpha * 0.34); }
      }
      // 3) STILTED SPOTTER'S SHACK — a tin box on four legs standing back-right, clear of the shed.
      { const [sx, sy] = F(fh * 0.72, -fh * 0.5), legTop = h * 0.85, cabTop = legTop + h * 0.42, r = fh * 0.13;
        for (const [lx, ly] of [[-r, -r], [r, -r], [r, r], [-r, r]]) { const [px, py] = F(fh * 0.72 + lx, -fh * 0.5 + ly); draw3DBoxAt(ctx, cam, px, py, fh * 0.02, 0, legTop, 'ty_reach_shack', seed + 5, night, alpha, false); }   // four legs
        draw3DBoxAt(ctx, cam, sx, sy, fh * 0.2, legTop, cabTop, 'ty_reach_shack', seed + 6, night, alpha, false);   // cabin
        draw3DBoxAt(ctx, cam, sx, sy, fh * 0.24, cabTop, cabTop + h * 0.07, 'ty_reach_rust', seed + 7, night, alpha, true);   // overhanging tin roof
        perchBird(ctx, cam, sx, sy, cabTop + h * 0.1, alpha);   // the buzzard, watching who lands
        blinkLight(ctx, cam, sx, sy, cabTop + h * 0.09, '255,72,60', now, seed + 6, alpha, 1.5);
        if (night) glowPool(ctx, cam, sx, sy, legTop + h * 0.2, '255,196,120', 7, alpha * 0.34);   // warm window
      }
      // 4) WINDSOCK — a tall pole front-left, sock hanging dead-still (no wind in the Reach).
      { const [wx, wy] = F(-fh * 0.86, fh * 0.7); windsockLimp(ctx, cam, wx, wy, 0, h * 1.05, alpha); }
      // 5) SALVAGE — a couple of fuel drums and a broken prop leaned on the apron.
      for (const [s, i] of [[-0.5, 0], [-0.34, 1]]) { const [bx, by] = F(fh * s, fh * 0.95); drawFacetDrum(ctx, cam, bx, by, 0, h * 0.18, fh * 0.08, fh * 0.08, 8, alpha, (f) => `rgb(${100 + f.nl * 60 | 0},${64 + f.nl * 40 | 0},40)`, 'rgb(70,46,30)'); }
      // 6) Apron: a cracked, faded taxi lead-in.
      { ctx.globalAlpha = alpha; ctx.lineCap = 'round';
        for (let i = 0; i < 4; i++) { const a = F(0, fh * (0.5 - i * 0.34)), b = F(0, fh * (0.5 - i * 0.34) - fh * 0.16); const pa = cam.proj(a[0], a[1], 0.02), pb = cam.proj(b[0], b[1], 0.02); if (pa.f > 0.1 && pb.f > 0.1) { ctx.strokeStyle = 'rgba(196,168,88,0.5)'; ctx.lineWidth = Math.max(1.4, 5 / (cam.proj(dx, dy, 0.02).f || 1)); ctx.beginPath(); ctx.moveTo(pa.sx, pa.sy); ctx.lineTo(pb.sx, pb.sy); ctx.stroke(); } }
        ctx.globalAlpha = 1; ctx.lineCap = 'butt';
      }
      if (night) { glowPool(ctx, cam, dx, dy, 0.02, '255,214,150', 24, alpha * 0.14); const [lx, ly] = F(fh * 0.8, fh * 0.7); glowPool(ctx, cam, lx, ly, h * 0.6, '255,208,140', 7, alpha * 0.4); }   // one sodium lamp on a bent pole
      break;
    }
    case 'saloon': {   // THE COYOTE'S REST (The Reach) — a wild-west FALSE-FRONT saloon: a low welded-
      // plate body behind a tall flat parapet, a boardwalk porch on posts, batwing doors, warm lantern
      // windows, a hitching rail, and a busted neon 'COYOTE'S REST' buzzing over the door.
      const P = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); };
      const bodyTop = h * 0.72, frontTop = h * 1.16, FR = fh * 1.0;
      // 1) Saloon body (welded plate) + 2) the FALSE FRONT parapet — a taller block pulled forward to
      //    the entrance face so it rises as a flat wall above the low roof behind (the classic western tell).
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.9, 0, bodyTop, pal, seed, night, alpha, true);
      { const [fx, fy] = F(0, fh * 0.16); draw3DBoxAt(ctx, cam, fx, fy, fh * 0.86, 0, frontTop, 'ty_reach_saloon_dk', seed + 1, night, alpha, true); }
      // 3) PORCH — a shed awning over the boardwalk on three posts, along the front.
      { const canZ0 = bodyTop * 0.5, canZ1 = bodyTop * 0.58, [cx, cy] = F(0, fh * 1.18);
        draw3DBoxAt(ctx, cam, cx, cy, fh * 0.94, canZ0, canZ1, 'ty_reach_board', seed + 2, night, alpha, true);   // awning
        for (const s of [-0.82, 0, 0.82]) { const [px, py] = F(fh * s, fh * 1.42); draw3DBoxAt(ctx, cam, px, py, fh * 0.03, 0, canZ0, 'ty_reach_saloon_dk', seed + 8 + s, night, alpha, false); }   // posts
      }
      // boardwalk plank strip on the ground in front
      { const pl = [P(-fh * 0.9, fh * 1.02, 0.02), P(fh * 0.9, fh * 1.02, 0.02), P(fh * 0.9, fh * 1.46, 0.02), P(-fh * 0.9, fh * 1.46, 0.02)]; if (pl.every(p => p.f > 0.1)) { ctx.globalAlpha = alpha; ctx.fillStyle = 'rgba(78,60,42,0.85)'; ctx.beginPath(); pl.forEach((p, i) => i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; } }
      // 4) Batwing doorway — a dark recessed opening + warm spill.
      { const [gx, gy] = F(0, fh * 0.94); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.2, 0, bodyTop * 0.44, 'ty_door', seed + 4, night, alpha, false); }
      // 5) HITCHING RAIL out front — a low bar on two posts.
      { const rz = bodyTop * 0.16; for (const s of [-0.6, 0.6]) { const [px, py] = F(fh * s, fh * 1.34); draw3DBoxAt(ctx, cam, px, py, fh * 0.02, 0, rz, 'ty_reach_saloon_dk', seed + 12 + s, night, alpha, false); }
        const a = P(-fh * 0.6, fh * 1.34, rz), b = P(fh * 0.6, fh * 1.34, rz); if (a.f > 0.1 && b.f > 0.1) emitFace(decoDepth(a.f, b.f), () => { ctx.globalAlpha = alpha; ctx.strokeStyle = 'rgba(52,40,28,0.9)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); ctx.globalAlpha = 1; }); }
      // 6) Busted neon on the false front — 'COYOTE'S REST' with half its letters dead (blanked out),
      //    the survivors buzzing on an irregular flicker (the sign the flavour text promises).
      if (frontVis) {
        const bz0 = frontTop * 0.58, bz1 = frontTop * 0.82, bhw = fh * 0.78;
        const TL = P(-bhw, FR + 0.006, bz1), TR = P(bhw, FR + 0.006, bz1), BR = P(bhw, FR + 0.006, bz0), BL = P(-bhw, FR + 0.006, bz0);
        if ([TL, TR, BR, BL].every(p => p.f > 0.12)) {
          const t = now || 0, buzz = (Math.sin(t * 0.03) + Math.sin(t * 0.017) > -0.7) ? 0.74 + 0.26 * Math.abs(Math.sin(t * 0.05)) : 0.14;
          const live = bakeSignText('C YOT ’S R ST', m.neon || '#ff6a3a', night ? 1 : 0, false);   // dead tubes → blank cells
          emitFace(decoDepth(TL.f, TR.f, BR.f, BL.f), () => drawSurfaceText(ctx, TL, TR, BR, BL, live, false, alpha * buzz));
        }
        if (night) { const [wx, wy] = F(0, fh * 0.9); glowPool(ctx, cam, wx, wy, bodyTop * 0.5, '255,190,110', 12, alpha * 0.4); }   // warm windows
      }
      if (night) glowPool(ctx, cam, dx, dy, frontTop * 0.72, '255,106,58', 14, alpha * 0.2);
      break;
    }
    case 'dynamo': {   // THE DYNAMO (The Reach) — a jury-rigged genset that 'argues with storms': a
      // scorched bolted-plate shack, a leaning smokestack belching black smoke, a slow tin windmill
      // on a lattice mast, patchwork fuel tanks, tangled cables, and blue arc-flashes at the junction.
      const shackTop = h * 0.72;
      // 1) Shack (bolted plate) + a SCORCH fan up the front wall (the storm's calling card).
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.82, 0, shackTop, pal, seed, night, alpha, true);
      if (frontVis) { const [lx, ly] = F(-fh * 0.3, fh * 0.83), [mx, my] = F(fh * 0.1, fh * 0.83), [tx, ty] = F(-fh * 0.1, fh * 0.83); emitFlat(ctx, cam, [[lx, ly, 0], [mx, my, 0], [tx, ty, shackTop * 0.92]], 'rgba(30,26,22,0.7)', alpha, { cullN: E, lift: 0.02 }); }
      // 2) LEANING SMOKESTACK — stacked boxes drifting sideways as they rise, black smoke + red tip.
      { let px = fh * 0.5, py = -fh * 0.3, z = 0, w = fh * 0.16; for (let i = 0; i < 4; i++) { const z1 = z + h * 0.42, [wx, wy] = F(px, py); draw3DBoxAt(ctx, cam, wx, wy, w, z, z1, 'ty_reach_tank', seed + 20 + i, night, alpha, i === 3); z = z1; px += fh * 0.07; w *= 0.9; }
        const [sx, sy] = F(px, py); drawSmoke(ctx, cam, sx, sy, z, '58,52,46', alpha, now, seed + 4); blinkLight(ctx, cam, sx, sy, z, '255,74,60', now, seed, alpha, 1.4); }
      // 3) WINDMILL — a lattice mast with a slow tin wheel, back-left; the wild-west power take-off.
      { const [wx, wy] = F(-fh * 0.6, -fh * 0.35), hubZ = h * 1.5; mast(ctx, cam, wx, wy, 0, hubZ, alpha, now, seed + 9); windWheel(ctx, cam, wx, wy, hubZ, fh * 34, now, alpha, seed); }
      // 4) FUEL TANKS — a big riveted upright tank on the flank + two small drums.
      { const [tx, ty] = F(-fh * 0.5, fh * 0.55); drawFacetDrum(ctx, cam, tx, ty, 0, h * 0.5, fh * 0.22, fh * 0.22, 10, alpha, (f) => `rgb(${104 + f.nl * 50 | 0},${72 + f.nl * 36 | 0},46)`, 'rgb(74,52,34)'); drawRing(ctx, cam, tx, ty, h * 0.3, fh * 0.225, 10, 'rgba(0,0,0,0.3)', 1, alpha); }
      for (const s of [0.4, 0.62]) { const [bx, by] = F(fh * s, fh * 0.5); drawFacetDrum(ctx, cam, bx, by, 0, h * 0.2, fh * 0.08, fh * 0.08, 8, alpha, (f) => `rgb(${96 + f.nl * 50 | 0},${88 + f.nl * 44 | 0},${72 + f.nl * 30 | 0})`, 'rgb(66,62,52)'); }
      // 5) CABLES — a couple of sagging lines from the shack eave to a short pole.
      { const [ex, ey] = F(fh * 0.2, fh * 0.4); const a = cam.proj(ex, ey, shackTop), pole = F(fh * 0.86, fh * 0.7); const pb = cam.proj(pole[0], pole[1], h * 0.34);
        draw3DBoxAt(ctx, cam, pole[0], pole[1], fh * 0.02, 0, h * 0.34, 'ty_reach_shack', seed + 30, night, alpha, false);
        if (a.f > 0.1 && pb.f > 0.1) emitFace(decoDepth(a.f, pb.f), () => { ctx.globalAlpha = alpha; ctx.strokeStyle = 'rgba(20,18,18,0.85)'; ctx.lineWidth = 1; for (const dz of [0, 4]) { ctx.beginPath(); ctx.moveTo(a.sx, a.sy + dz); ctx.quadraticCurveTo((a.sx + pb.sx) / 2, Math.max(a.sy, pb.sy) + 8 + dz, pb.sx, pb.sy + dz); ctx.stroke(); } ctx.globalAlpha = 1; }); }
      // 6) ARC JUNCTION — a fast blue-white flash + an electric hum glow at the shack shoulder.
      { const [jx, jy] = F(fh * 0.3, fh * 0.5); const t = now || 0, arc = (Math.sin(t * 0.09) + Math.sin(t * 0.061)) > 1.2; blinkLight(ctx, cam, jx, jy, shackTop * 0.8, '150,230,255', now, seed + 2, alpha, arc ? 2.6 : 1.2); if (night) glowPool(ctx, cam, jx, jy, shackTop * 0.7, '108,240,255', 8, alpha * 0.3); }
      break;
    }
    case 'layover': {   // THE LAYOVER (The Reach) — a slag-and-glass desert motel: a low cabin row under
      // one long shed roof with repeating warm doors, a beat-up water tower on legs, and a roadside
      // pylon — a vertical MOTEL blade + a pink 'VA ANCY' sign flickering with its long-dead 'C'.
      const P = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); };
      const wallTop = h * 0.5;
      // 1) CABIN STRIP — a low wide body + a shallow overhanging shed roof, repeating doors + windows.
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.1, 0, wallTop, pal, seed, night, alpha, false);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.18, wallTop, wallTop + h * 0.07, 'ty_reach_motel_roof', seed + 1, night, alpha, true);   // overhanging shed roof
      for (const s of [-0.72, -0.24, 0.24, 0.72]) { const [gx, gy] = F(fh * s, fh * 1.12); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.12, 0, wallTop * 0.62, 'ty_door', seed + 10 + s * 3, night, alpha, false); if (night) { const [wx, wy] = F(fh * (s + 0.14), fh * 1.1); glowPool(ctx, cam, wx, wy, wallTop * 0.55, '255,196,120', 6, alpha * 0.34); } }   // doors + warm cabin windows
      // 2) WATER TOWER — four splayed legs + a riveted tank + a conical cap, standing back-left.
      { const cxL = -fh * 0.7, cyL = -fh * 0.55, [wx, wy] = F(cxL, cyL), legTop = h * 1.0, tankTop = legTop + h * 0.34, r = fh * 0.24;
        for (const [ox, oy] of [[-r, -r], [r, -r], [r, r], [-r, r]]) { const [px, py] = F(cxL + ox, cyL + oy); draw3DBoxAt(ctx, cam, px, py, fh * 0.02, 0, legTop, 'ty_reach_water', seed + 20, night, alpha, false); }   // legs
        drawFacetDrum(ctx, cam, wx, wy, legTop, tankTop, r * 1.05, r * 1.05, 10, alpha, (f) => `rgb(${96 + f.nl * 46 | 0},${84 + f.nl * 40 | 0},${68 + f.nl * 30 | 0})`, 'rgb(66,58,46)');   // tank
        drawRing(ctx, cam, wx, wy, legTop + h * 0.17, r * 1.06, 10, 'rgba(0,0,0,0.28)', 1, alpha);
        drawFacetDrum(ctx, cam, wx, wy, tankTop, tankTop + h * 0.16, r * 1.05, 0.001, 10, alpha, (f) => `rgb(${74 + f.nl * 30 | 0},${52 + f.nl * 24 | 0},34)`);   // conical cap
        blinkLight(ctx, cam, wx, wy, tankTop + h * 0.18, '255,74,60', now, seed + 21, alpha, 1.3); }
      // 3) ROADSIDE PYLON — a tall post carrying a vertical MOTEL blade + a flickering 'VA ANCY' board.
      { const [px, py] = F(fh * 0.86, fh * 0.9); draw3DBoxAt(ctx, cam, px, py, fh * 0.04, 0, h * 1.5, 'ty_reach_saloon_dk', seed + 30, night, alpha, false);   // post
        verticalMarquee(ctx, cam, px, py, h * 0.86, h * 1.62, 'MOTEL', m.neon || '#ff5a86', night, alpha, E);
        // VA ANCY (dead 'C') on a small board facing the strip — surface text with a buzz flicker.
        const bz0 = h * 0.58, bz1 = h * 0.8, bhw = fh * 0.3;
        const [blx, bly] = F(fh * 0.86 - bhw, fh * 0.9 + 0.05), [brx, bry] = F(fh * 0.86 + bhw, fh * 0.9 + 0.05);
        const TL = cam.proj(blx, bly, bz1), TR = cam.proj(brx, bry, bz1), BR = cam.proj(brx, bry, bz0), BL = cam.proj(blx, bly, bz0);
        if ([TL, TR, BR, BL].every(p => p.f > 0.12)) { const t = now || 0, buzz = (Math.sin(t * 0.02) > -0.6) ? 0.85 : 0.2; const tex = bakeSignText('VA ANCY', '#ff8fb0', night ? 1 : 0, false); emitFace(decoDepth(TL.f, TR.f, BR.f, BL.f), () => drawSurfaceText(ctx, TL, TR, BR, BL, tex, false, alpha * buzz)); } }
      // 4) A porch light kept burning like a habit.
      { const [lx, ly] = F(-fh * 0.95, fh * 1.14); glowPool(ctx, cam, lx, ly, wallTop * 0.7, '255,206,140', 6, alpha * (night ? 0.5 : 0.28)); }
      break;
    }
    case 'hangar': {   // AIRPORT: glazed passenger terminal + hangar shed + ATC tower, floodlit at night
      const top = h * (m.big ? 0.66 : 0.56), NF = 12;
      // Shared surface styles (reused by the terminal + the tower): shaded concrete/steel facets and
      // the procedural curtain glass (a vertical sky-reflection gradient, facet-lit — no window grid).
      const base = WALL_COL[pal] || [96, 102, 112];
      const concrete = (f) => { const s = 0.6 + f.nl * 0.5; return `rgb(${base[0] * s | 0},${base[1] * s | 0},${base[2] * s | 0})`; };
      const steel = (r, gc, b) => (f) => { const s = 0.5 + f.nl * 0.5; return `rgb(${r * s | 0},${gc * s | 0},${b * s | 0})`; };
      const glass = (f, tp, bt) => {
        const g = ctx.createLinearGradient(0, tp, 0, bt), s = 0.55 + f.nl * 0.45;
        if (night) {
          g.addColorStop(0, `rgba(${70 * s | 0},${120 * s | 0},${150 * s | 0},0.95)`);
          g.addColorStop(0.55, `rgba(${52 * s | 0},${92 * s | 0},${120 * s | 0},0.95)`);
          g.addColorStop(1, 'rgba(210,178,120,0.95)');                                                             // warm consoles glimpsed low
        } else {
          g.addColorStop(0, `rgba(${150 + f.nl * 80 | 0},${188 + f.nl * 50 | 0},224,0.96)`);                       // bright sky-reflection crown
          g.addColorStop(0.5, `rgba(${78 + f.nl * 70 | 0},${120 + f.nl * 70 | 0},158,0.95)`);
          g.addColorStop(1, `rgba(${26 + f.nl * 28 | 0},${42 + f.nl * 28 | 0},62,0.96)`);                          // deep sill
        }
        return g;
      };
      // 1. PASSENGER LOUNGE — a curved glass pavilion on the apron with a warm-lit INTERIOR read
      //    through semi-transparent glass (a warm floor, a bench row, a couple of waiting passengers),
      //    a transom band, a slim entrance canopy and a rooftop spill. New procedural interior.
      { const [lx, ly] = F(fh * 0.42, fh * 0.48), lH = top * 0.5, lR = fh * 0.44;
        const loungeGlass = (f, tp, bt) => {   // cooler + MORE TRANSPARENT than the cab glass so the lit interior shows through
          const g = ctx.createLinearGradient(0, tp, 0, bt);
          g.addColorStop(0, `rgba(${168 + f.nl * 60 | 0},${204 + f.nl * 40 | 0},234,0.5)`);
          g.addColorStop(1, `rgba(${58 + f.nl * 40 | 0},${88 + f.nl * 40 | 0},120,0.46)`);
          return g;
        };
        // Interior at the pavilion's CENTRE depth → sorts behind the near (semi-transparent) glass
        // facets and in front of the far ones, so it reads as a lit lounge seen through the glass.
        emitFace(cam.proj(lx, ly, lH * 0.4).f, () => {
          ctx.globalAlpha = alpha;
          const fp = cam.proj(lx, ly, 0.02);
          if (fp.f > 0.1) { const r = clamp(24 / fp.f, 6, 40), rg = ctx.createRadialGradient(fp.sx, fp.sy, 1, fp.sx, fp.sy, r); rg.addColorStop(0, 'rgba(255,222,166,0.55)'); rg.addColorStop(1, 'rgba(255,222,166,0)'); ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(fp.sx, fp.sy, r, 0, 7); ctx.fill(); }   // warm floor pool
          for (let i = -2; i <= 2; i++) { const sp = cam.proj(lx + i * fh * 0.12, ly + fh * 0.16, 0.03); if (sp.f <= 0.1) continue; const sz = clamp(3.6 / sp.f, 1.2, 7); ctx.fillStyle = 'rgba(28,26,30,0.8)'; ctx.fillRect(sp.sx - sz * 0.6, sp.sy - sz * 0.55, sz * 1.2, sz * 0.7); }   // bench row
          for (const dxF of [-fh * 0.16, fh * 0.12]) { const gp = cam.proj(lx + dxF, ly + fh * 0.04, 0.02), hp = cam.proj(lx + dxF, ly + fh * 0.04, lH * 0.34); if (gp.f <= 0.1 || hp.f <= 0.1) continue; const bw = clamp(2 / gp.f, 0.8, 5); ctx.fillStyle = 'rgba(22,20,26,0.85)'; ctx.beginPath(); ctx.moveTo(gp.sx - bw, gp.sy); ctx.lineTo(gp.sx + bw, gp.sy); ctx.lineTo(hp.sx + bw * 0.6, hp.sy); ctx.lineTo(hp.sx - bw * 0.6, hp.sy); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.arc(hp.sx, hp.sy - bw * 0.5, bw * 0.7, 0, 7); ctx.fill(); }   // waiting passengers
          ctx.globalAlpha = 1;
        });
        drawFacetDrum(ctx, cam, lx, ly, 0, lH, lR, lR * 0.98, 16, alpha, loungeGlass, steel(52, 58, 68)({ nl: 0.72 }));   // curved glass envelope (solid roof cap) over the lit interior
        drawRing(ctx, cam, lx, ly, lH * 0.5, lR * 0.99, 16, 'rgba(20,26,34,0.5)', 1, alpha);                         // mullion transom band
        const [cx, cy] = F(fh * 0.42, fh * 0.96); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.4, lH * 0.32, lH * 0.42, 'ty_door', seed + 9, night, alpha, false);   // entrance canopy
        glowPool(ctx, cam, lx, ly, lH * 0.62, '255,214,150', 18, alpha * (night ? 0.4 : 0.2));                       // interior spill up top
      }
      // 2. HANGAR — a smaller corrugated-STEEL shed standing to the LEFT (clear of the tower) under a
      //    curved BARREL ROOF, with an OPEN bay on the apron gable — a recessed dark interior, a floor,
      //    a parked-aircraft tail hint and warm spill — instead of a closed door.
      { const hxL = -fh * 0.55, hw = fh * 0.5, wallTop = top * 0.52, archH = hw * 0.95;
        const [hx, hy] = F(hxL, 0);
        draw3DBoxAt(ctx, cam, hx, hy, hw, 0, wallTop, 'ty_hangarmetal', seed, night, alpha, false);                 // ribbed-steel walls (roof capped by the barrel)
        drawBarrelRoof(ctx, cam, F, hxL, hw, hw, wallTop, archH, 10, alpha, [138, 146, 156]);                        // curved corrugated roof + arched gables
        // Open bay on the apron-facing (+local-y) gable — only when that gable faces the camera.
        const [ox, oy] = F(0, 0), [f1x, f1y] = F(0, 1), FX = f1x - ox, FY = f1y - oy, [gcx, gcy] = F(hxL, hw);
        if (FX * gcx + FY * gcy + (cam.back || 0) * (FX * cam.sinh - FY * cam.cosh) < 0) {
          const P = (llx, lly, z) => { const [wx, wy] = F(llx, lly); return cam.proj(wx, wy, z); };
          const odw = hw * 0.58, oTop = wallTop * 0.82, inset = hw * 0.55;
          const o = [P(hxL - odw, hw + 0.003, 0), P(hxL + odw, hw + 0.003, 0), P(hxL + odw, hw + 0.003, oTop), P(hxL - odw, hw + 0.003, oTop)];
          if (o.every(p => p.f > 0.1)) emitFace(o.reduce((s, p) => s + p.f, 0) / 4 - 0.002, () => {   // just proud of the wall → reads as cut into it
            const trace = (pp) => { ctx.beginPath(); pp.forEach((p, i) => i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.closePath(); };
            ctx.globalAlpha = alpha;
            ctx.fillStyle = night ? 'rgba(46,40,30,0.96)' : 'rgba(16,18,22,0.97)'; trace(o); ctx.fill();   // dark opening
            const bk = [P(hxL - odw * 0.86, hw - inset, 0), P(hxL + odw * 0.86, hw - inset, 0), P(hxL + odw * 0.86, hw - inset, oTop * 0.9), P(hxL - odw * 0.86, hw - inset, oTop * 0.9)];
            if (bk.every(p => p.f > 0.1)) { ctx.fillStyle = night ? 'rgba(70,60,42,0.95)' : 'rgba(28,30,34,0.96)'; trace(bk); ctx.fill(); }   // recessed back wall = interior depth
            const fl = [P(hxL - odw, hw + 0.003, 0.006), P(hxL + odw, hw + 0.003, 0.006), P(hxL + odw * 0.86, hw - inset, 0.006), P(hxL - odw * 0.86, hw - inset, 0.006)];
            if (fl.every(p => p.f > 0.1)) { ctx.fillStyle = 'rgba(44,46,50,0.9)'; trace(fl); ctx.fill(); }   // interior floor
            const tb = P(hxL + odw * 0.15, hw - inset * 0.7, 0.01), tt = P(hxL + odw * 0.15, hw - inset * 0.7, oTop * 0.72), tn = P(hxL - odw * 0.35, hw - inset * 0.55, oTop * 0.28);
            if ([tb, tt, tn].every(p => p.f > 0.1)) { ctx.fillStyle = 'rgba(122,128,136,0.5)'; ctx.beginPath(); ctx.moveTo(tb.sx, tb.sy); ctx.lineTo(tt.sx, tt.sy); ctx.lineTo(tn.sx, tn.sy); ctx.closePath(); ctx.fill(); }   // parked-aircraft tail hint
            ctx.strokeStyle = 'rgba(8,10,12,0.9)'; ctx.lineWidth = 1.4; trace(o); ctx.stroke();   // opening frame
            ctx.globalAlpha = 1;
          });
          if (night) { const [obx, oby] = F(hxL, hw); glowPool(ctx, cam, obx, oby, wallTop * 0.3, '255,206,140', 12, alpha * 0.3); }   // warm spill from the open bay
        }
      }
      // 3. ATC TOWER — a rounded, high-detail control tower built from FACETED DRUMS (not boxes, so it
      //    doesn't read blocky): a splayed plinth, a banded tapering concrete shaft, a cantilevered
      //    catwalk gallery, and a wide CURTAIN-GLASS control cab drawn with a procedural per-facet
      //    reflection (bright sky sheen up top → deep sill, warm consoles at night) — no window grid —
      //    under an overhanging roof cap. Rooftop mast + whips; red obstruction + green↔white beacon.
      { const [txx, txy] = F(fh * 0.7, -fh * 0.55), big = m.big;   // stands ALONE back-right, clear of the hangar
        const cabTop = h * (big ? 2.0 : 1.65), galZ = cabTop * 0.72, plZ = cabTop * 0.1;
        const cabBot = galZ + cabTop * 0.03, roofTopZ = cabTop + cabTop * 0.05;
        drawFacetDrum(ctx, cam, txx, txy, 0, plZ, fh * 0.3, fh * 0.24, NF, alpha, concrete, concrete({ nl: 0.7 }));   // splayed plinth
        drawFacetDrum(ctx, cam, txx, txy, plZ, galZ, fh * 0.2, fh * 0.14, NF, alpha, concrete);                       // tapering shaft (one smooth cone)
        for (const t of [0.3, 0.55, 0.8]) { const z = plZ + (galZ - plZ) * t, r = fh * (0.2 + (0.14 - 0.2) * t); drawRing(ctx, cam, txx, txy, z, r + 0.004, NF, 'rgba(0,0,0,0.28)', 1, alpha); }   // poured-lift band rings
        drawFacetDrum(ctx, cam, txx, txy, galZ, cabBot, fh * 0.3, fh * 0.3, NF, alpha, steel(40, 44, 50), 'rgb(46,50,58)');   // cantilevered catwalk gallery
        drawRing(ctx, cam, txx, txy, cabBot + cabTop * 0.05, fh * 0.31, NF, 'rgba(150,160,172,0.75)', 1.2, alpha);            // gallery rail
        drawFacetDrum(ctx, cam, txx, txy, cabBot, cabTop, fh * 0.32, fh * 0.3, NF, alpha, glass);                             // curtain-glass control cab
        for (const t of [0.4, 0.72]) drawRing(ctx, cam, txx, txy, cabBot + (cabTop - cabBot) * t, fh * 0.315, NF, 'rgba(14,20,28,0.4)', 1, alpha);   // faint transom rings
        drawFacetDrum(ctx, cam, txx, txy, cabTop, roofTopZ, fh * 0.36, fh * 0.34, NF, alpha, steel(34, 38, 44), 'rgb(40,44,52)');   // overhanging roof cap
        const mastTop = cabTop + h * (big ? 0.5 : 0.4);
        mast(ctx, cam, txx, txy, roofTopZ, mastTop, alpha, now, seed + 6);                                            // antenna mast (draws its own red tip light)
        for (const s of [-0.018, 0.022]) {   // a couple of shorter whip antennas beside the mast
          const p0 = cam.proj(txx + s, txy, roofTopZ), p1 = cam.proj(txx + s, txy, cabTop + h * 0.2);
          if (p0.f > 0.1 && p1.f > 0.1) emitFace(decoDepth(p0.f, p1.f), () => { ctx.globalAlpha = alpha; ctx.strokeStyle = 'rgba(40,44,50,0.9)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p0.sx, p0.sy); ctx.lineTo(p1.sx, p1.sy); ctx.stroke(); ctx.globalAlpha = 1; });
        }
        if (night) {
          glowPool(ctx, cam, txx, txy, (cabBot + cabTop) / 2, '150,220,255', 10, alpha * 0.42);                   // lit cab halo
          // Civil rotating beacon: green & white pulses a half-cycle out of phase (seed + π).
          blinkLight(ctx, cam, txx, txy, cabTop + h * 0.05, '120,255,150', now, seed + 7, alpha, 2.1);
          blinkLight(ctx, cam, txx, txy, cabTop + h * 0.05, '235,245,255', now, seed + 7 + Math.PI, alpha, 1.9);
        }
        blinkLight(ctx, cam, txx, txy, mastTop, '255,70,70', now, seed + 6, alpha, 1.6);                           // red obstruction light at the mast tip
      }
      // 4. APRON — painted ramp markings on the tarmac (a taxiway centreline lead-in + tie-down
      //    circles), floodlit with blue edge lights at night.
      { ctx.globalAlpha = alpha; ctx.lineCap = 'round';
        const seg = (l0, l1, style, lw) => { const a = cam.proj(l0[0], l0[1], 0.02), b = cam.proj(l1[0], l1[1], 0.02); if (a.f > 0.1 && b.f > 0.1) { ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); } };
        for (let i = 0; i < 5; i++) { const y0 = fh * (0.6 - i * 0.3), y1 = y0 - fh * 0.16; seg(F(0, y0), F(0, y1), 'rgba(240,208,70,0.8)', Math.max(1.5, 6 / (cam.proj(dx, dy, 0.02).f || 1))); }   // yellow taxiway lead-in dashes
        for (const s of [-0.62, 0.62]) { const cc = F(s * fh, -fh * 0.1); const pts = []; let ok = true; for (let k = 0; k <= 12; k++) { const a = k / 12 * 6.2832, p = cam.proj(cc[0] + Math.cos(a) * fh * 0.12, cc[1] + Math.sin(a) * fh * 0.12, 0.02); if (p.f <= 0.1) { ok = false; break; } pts.push(p); } if (ok) { ctx.strokeStyle = 'rgba(230,236,240,0.5)'; ctx.lineWidth = 1.4; ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.closePath(); ctx.stroke(); } }   // parking tie-down circles
        ctx.globalAlpha = 1; ctx.lineCap = 'butt';
      }
      if (night) {
        glowPool(ctx, cam, dx, dy, 0.02, '255,236,190', 30, alpha * 0.16);                                        // sodium apron floods
        for (const s of [-0.7, -0.23, 0.23, 0.7]) { const [ex, ey] = F(fh * s, fh * 0.95); blinkLight(ctx, cam, ex, ey, 0.02, '90,150,255', now, seed + s * 10, alpha, 1.3); }
        if (m.helipad) glowPool(ctx, cam, dx, dy, top + 0.01, '255,210,90', 14, alpha * 0.3);
      }
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
    case 'bar': {   // narrow street-corner bar — a taller slim box, a lit door awning + a neon blade
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.82, 0, h * 0.95, pal, seed, night, alpha, true);
      { const [ax, ay] = F(0, fh * 0.82); draw3DBoxAt(ctx, cam, ax, ay, fh * 0.78, h * 0.22, h * 0.34, 'ty_door', seed + 1, night, alpha, false); }   // door awning
      { const [nx, ny] = F(fh * 0.5, fh * 0.4); neonBlade(ctx, cam, nx, ny, h * 0.34, h * 1.2, m.neon || '#5fd0ff', night, alpha); }
      if (night) glowPool(ctx, cam, dx, dy, h * 0.24, '120,220,255', 9, alpha * 0.2);
      break;
    }
    case 'club': {   // box + twin neon roofline + colour glow
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.05, 0, h * 0.8, pal, seed, night, alpha, true);
      { const [ax, ay] = F(-fh * 0.4, 0); neonBlade(ctx, cam, ax, ay, h * 0.8, h * 1.15, m.neon || '#ff4a9a', night, alpha); }
      { const [bx, by] = F(fh * 0.4, 0); neonBlade(ctx, cam, bx, by, h * 0.8, h * 1.15, m.neon || '#ff4a9a', night, alpha); }
      glowPool(ctx, cam, dx, dy, h * 0.85, '255,74,154', 20, alpha * (night ? 0.34 : 0.16));
      break;
    }
    case 'diner': {   // streamline diner — a long low stainless car under a curved barrel roof, glazed front, counter awning, rooftop neon
      const hw = fh * 1.12, wallTop = h * 0.52, archH = hw * 0.34;
      draw3DBoxAt(ctx, cam, dx, dy, hw, 0, wallTop, pal, seed, night, alpha, false);                                    // diner body (roof left open for the barrel)
      drawBarrelRoof(ctx, cam, F, 0, hw, hw * 0.9, wallTop, archH, 12, alpha, [150, 150, 156]);                         // curved streamline stainless roof
      { const [ax, ay] = F(0, fh * 0.95); draw3DBoxAt(ctx, cam, ax, ay, fh * 1.06, wallTop * 0.42, wallTop * 0.64, 'ty_door', seed + 1, night, alpha, false); }   // counter awning faces the street
      neonBlade(ctx, cam, dx, dy, wallTop + archH, wallTop + archH + h * 0.42, m.neon || '#ffcf3e', night, alpha);      // rooftop neon sign
      if (night) { const [wx, wy] = F(0, fh * 0.92); glowPool(ctx, cam, wx, wy, wallTop * 0.5, '255,200,120', 13, alpha * 0.26); }   // warm window band
      break;
    }
    case 'laundromat': {   // The Wash: a low flat-roofed shopfront that is mostly window — the one place on Ironside you can see all the way into from the street
      const hw = fh * 1.1, wallTop = h * 0.56;
      draw3DBoxAt(ctx, cam, dx, dy, hw, 0, wallTop, pal, seed, night, alpha, true);                                       // single-storey box
      { const [gx, gy] = F(0, fh * 0.96); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.96, 0, wallTop * 0.82, 'ty_marble_col', seed + 1, night, alpha, false); }  // the big glazed front
      neonBlade(ctx, cam, dx, dy, wallTop, wallTop + h * 0.3, m.neon || '#7fe3ff', night, alpha);                          // cold-blue WASH sign
      // Lit all night, deliberately: this is the building that says somebody is still open.
      if (night) { const [wx, wy] = F(0, fh * 0.9); glowPool(ctx, cam, wx, wy, wallTop * 0.6, '210,235,255', 18, alpha * 0.34); }
      break;
    }
    case 'armory': {   // Ironside Arms: a squat riveted blockhouse — heavy overhanging parapet, vault door, slit-window glow
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.15, 0, h * 0.7, pal, seed, night, alpha, true);          // bunker box
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.24, h * 0.7, h * 0.82, pal, seed + 1, night, alpha, true); // thick overhanging parapet
      { const [gx, gy] = F(0, fh * 0.95); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.46, 0, h * 0.4, 'ty_door', seed + 2, night, alpha, false); }   // vault door
      if (night) { const [wx, wy] = F(fh * 0.5, fh * 0.9); glowPool(ctx, cam, wx, wy, h * 0.34, '255,140,80', 6, alpha * 0.22); }   // amber slit window
      neonBlade(ctx, cam, dx, dy, h * 0.82, h * 1.06, m.neon || '#ff6a4a', night, alpha);           // small hard sign
      break;
    }
    case 'casino': {   // The Lucky Bastard: a squat house drowned in neon — marquee crown, chasing bulbs, magenta wash
      const neon = m.neon || '#ff3e8a';
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.15, 0, h * 0.7, pal, seed, night, alpha, true);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.22, h * 0.7, h * 0.9, pal, seed + 1, night, alpha, true); // marquee crown band
      { const [ax, ay] = F(-fh * 0.5, 0); neonBlade(ctx, cam, ax, ay, h * 0.9, h * 1.3, neon, night, alpha); }
      { const [bx, by] = F(fh * 0.5, 0); neonBlade(ctx, cam, bx, by, h * 0.9, h * 1.3, neon, night, alpha); }
      for (const s of [-0.7, -0.24, 0.24, 0.7]) { const [lx, ly] = F(s * fh, fh * 0.9); blinkLight(ctx, cam, lx, ly, h * 0.92, '255,210,90', now, seed + s * 9, alpha, 1.7); }   // chasing marquee bulbs
      glowPool(ctx, cam, dx, dy, h * 0.86, '255,62,138', 22, alpha * (night ? 0.4 : 0.2));           // neon wash
      break;
    }
    case 'neonvig': {   // The Lucky Bastard — the city's casino, promoted off the generic `casino` box into a
      //                    landmark: a stepped marquee crown over a squat plum house, a TALL blade-sign
      //                    tower with bulbs chasing up it, a porte-cochère over the entrance, a lit
      //                    rooftop drum, and enough magenta spill to read from the far side of the basin.
      const neon = m.neon || '#ff3e8a';
      const houseTop = h * 0.72, crownTop = h * 0.95;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.16, 0, houseTop, pal, seed, night, alpha, true);                    // the house
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.26, houseTop, crownTop, 'ty_vig_trim', seed + 1, night, alpha, true); // stepped marquee crown
      // Sign tower — the tall vertical that makes it a landmark rather than a shed.
      { const [tx, ty] = F(-fh * 0.72, -fh * 0.2);
        draw3DBoxAt(ctx, cam, tx, ty, fh * 0.26, 0, h * 1.9, 'ty_vig_trim', seed + 2, night, alpha, true);
        neonBlade(ctx, cam, tx, ty, h * 0.9, h * 2.35, neon, night, alpha);                                     // the blade itself
        for (let k = 0; k < 7; k++) blinkLight(ctx, cam, tx, ty, h * (0.95 + k * 0.2), '255,210,90', now, seed + k * 3, alpha, 1.8);   // bulbs chasing up the tower
        blinkLight(ctx, cam, tx, ty, h * 1.95, '255,80,80', now, seed, alpha, 2.0); }                           // aviation light on top
      // Rooftop drum — a lit cupola over the gaming floor.
      drawFacetDrum(ctx, cam, dx, dy, crownTop, crownTop + h * 0.26, fh * 0.42, fh * 0.42, 12, alpha,
        (f) => { const sh = 0.5 + f.nl * 0.5; return `rgb(${112 * sh | 0},${62 * sh | 0},${92 * sh | 0})`; }, 'rgb(70,38,58)');
      drawRing(ctx, cam, dx, dy, crownTop + h * 0.26, fh * 0.44, 14, night ? 'rgba(255,62,138,0.85)' : 'rgba(255,140,190,0.45)', 2, alpha);
      // Porte-cochère over the entrance + marquee band on the frontage.
      if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh, houseTop * 1.02, neon, night, alpha);
      { const [cx, cy] = F(0, fh * 1.05); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.62, h * 0.30, h * 0.38, 'ty_vig_trim', seed + 6, night, alpha, false);
        for (const s of [-1, 1]) { const [px, py] = F(s * fh * 0.5, fh * 1.05); draw3DBoxAt(ctx, cam, px, py, fh * 0.05, 0, h * 0.30, 'ty_vig_trim', seed + 7 + s, night, alpha, false); } }   // canopy + its posts
      for (const s of [-0.78, -0.26, 0.26, 0.78]) { const [lx, ly] = F(s * fh, fh * 0.98); blinkLight(ctx, cam, lx, ly, crownTop * 0.99, '255,210,90', now, seed + s * 9, alpha, 1.7); }   // parapet bulbs
      glowPool(ctx, cam, dx, dy, houseTop * 0.9, '255,62,138', 30, alpha * (night ? 0.55 : 0.24));              // the wash
      if (night) glowPool(ctx, cam, dx, dy, h * 0.10, '255,150,200', 16, alpha * 0.3);                          // pavement spill at the doors
      break;
    }
    case 'reefer': {   // Coldline Reefer Depot — twin of Basin Cold Store (a plain insulated block). Reads
      //                   differently by being a PLANT plus a long rank of white reefer containers on
      //                   plug-in racks, each with its own blue compressor light, under one tall ammonia stack.
      const blockTop = h * 0.52;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.78, 0, blockTop, pal, seed, night, alpha, true);                     // compressor plant (smaller than the twin's block)
      for (const s of [-0.3, 0.3]) { const [ux, uy] = F(s * fh * 0.5, -fh * 0.1); draw3DBoxAt(ctx, cam, ux, uy, fh * 0.18, blockTop, blockTop + h * 0.14, 'ty_cold_unit', seed + 3 + s * 5, night, alpha, true); }
      // The rank of reefers — an ordered LINE (the twin's containers are a random 3×3 scatter).
      for (let k = -2; k <= 2; k++) {
        const [bx, by] = F(k * fh * 0.42, fh * 0.72);
        draw3DBoxAt(ctx, cam, bx, by, fh * 0.19, 0, h * 0.30, 'ty_reefer', seed + 10 + k, night, alpha, true);
        blinkLight(ctx, cam, bx, by, h * 0.32, '110,190,255', now, seed + k * 7, alpha, 1.4);                   // compressor running light
      }
      { const [sx, sy] = F(fh * 0.55, -fh * 0.35);                                                              // ammonia stack
        draw3DBoxAt(ctx, cam, sx, sy, fh * 0.10, 0, h * 1.5, 'ty_cold_unit', seed + 20, night, alpha, false);
        drawSmoke(ctx, cam, sx, sy, h * 1.5, '190,205,215', alpha * 0.5, now, seed + 21); }
      glowPool(ctx, cam, dx, dy, h * 0.20, '150,200,230', 16, alpha * (night ? 0.36 : 0.2));                    // cold breath, pooled low
      break;
    }
    case 'interstack': {   // Interchange Stack — twin of Coldwater Container Yard (a loose 3×3 scatter ≤3 high).
      //                     Reads differently by being ORDERED and TALLER: two regimented rows stacked 4–5
      //                     high, straddled by a blue rail-mounted gantry crane. The crane is the tell.
      const cols = ['ty_cont_r', 'ty_cont_b', 'ty_cont_g', 'ty_cont_y'];
      const hsh = (a) => { a = (a ^ 61) ^ (a >> 16); a += a << 3; a ^= a >> 4; a = Math.imul(a, 0x27d4eb2d); return (a ^ (a >> 15)) >>> 0; };
      for (const row of [-0.5, 0.5]) for (let k = -2; k <= 2; k++) {
        const stack = 4 + hsh(seed + k * 11 + row * 31) % 2;                                                    // 4..5 high — over the twin's 1..3
        const [bx, by] = F(k * fh * 0.40, row * fh * 0.62);
        for (let z = 0; z < stack; z++) draw3DBoxAt(ctx, cam, bx, by, fh * 0.18, h * 0.20 * z, h * 0.20 * (z + 1), cols[hsh(seed + k * 3 + z * 5 + row * 17) & 3], seed + z, night, alpha, true);
      }
      // Rail gantry straddling both rows: two portal legs + a spanning girder + a trolley.
      const gTop = h * 1.25;
      for (const s of [-1, 1]) { const [lx, ly] = F(s * fh * 1.0, -fh * 0.05); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.07, 0, gTop, 'ty_gantry', seed + 40 + s, night, alpha, false); }
      { const [l0x, l0y] = F(-fh * 1.0, -fh * 0.05), [l1x, l1y] = F(fh * 1.0, -fh * 0.05);
        const a = cam.proj(l0x, l0y, gTop), b = cam.proj(l1x, l1y, gTop);
        if (a.f > 0.1 && b.f > 0.1) emitFace(decoDepth(a.f, b.f), () => { ctx.globalAlpha = alpha; ctx.strokeStyle = 'rgba(58,92,132,0.95)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); ctx.globalAlpha = 1; }); }
      { const [tx, ty] = F(fh * 0.25, -fh * 0.05); draw3DBoxAt(ctx, cam, tx, ty, fh * 0.13, gTop - h * 0.14, gTop, 'ty_gantry', seed + 45, night, alpha, true);
        blinkLight(ctx, cam, tx, ty, gTop + 0.004, '255,190,80', now, seed + 46, alpha, 1.6); }                 // trolley + its beacon
      break;
    }
    case 'foundry': {   // Ferro Fabrication Works — twin of Fabrication Shed (open shed + gantry + one flue).
      //                    Reads differently as a real FOUNDRY: a fat cupola furnace with a glowing mouth,
      //                    TWIN tall chimneys pushing heavy smoke, and a slag heap cooling out back.
      const shedTop = h * 0.5;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.0, 0, shedTop, pal, seed, night, alpha, true);                       // melt house
      { const [fx, fy] = F(-fh * 0.15, -fh * 0.1);                                                              // cupola furnace — a fat drum
        drawFacetDrum(ctx, cam, fx, fy, 0, h * 1.05, fh * 0.34, fh * 0.30, 12, alpha,
          (f) => { const sh = 0.5 + f.nl * 0.5; return `rgb(${96 * sh | 0},${84 * sh | 0},${76 * sh | 0})`; }, 'rgb(62,54,50)');
        drawRing(ctx, cam, fx, fy, h * 0.34, fh * 0.35, 12, 'rgba(255,120,40,0.55)', 2, alpha);                 // glowing tap ring
        glowPool(ctx, cam, fx, fy, h * 0.30, '255,120,40', 14, alpha * (night ? 0.55 : 0.3)); }                 // the pour
      for (const s of [-1, 1]) { const [sx, sy] = F(s * fh * 0.62, -fh * 0.45);                                 // twin chimneys
        draw3DBoxAt(ctx, cam, sx, sy, fh * 0.12, 0, h * 1.95, 'ty_foundry_stack', seed + 50 + s, night, alpha, false);
        blinkLight(ctx, cam, sx, sy, h * 1.95, '255,80,70', now, seed + 52 + s, alpha, 1.5);
        drawSmoke(ctx, cam, sx, sy, h * 1.95, '86,80,74', alpha * 0.8, now, seed + 54 + s); }
      { const [hx, hy] = F(fh * 0.72, fh * 0.7); draw3DBoxAt(ctx, cam, hx, hy, fh * 0.34, 0, h * 0.18, 'ty_slag', seed + 60, night, alpha, true);
        if (night) glowPool(ctx, cam, hx, hy, h * 0.16, '255,90,40', 8, alpha * 0.35); }                        // slag heap, still cooling
      break;
    }
    case 'oldoffice': {   // Meltwater Freight Office — twin of Yards Freight Office (a tidy 2-storey + sign band).
      //                     Meltwater Row is the older, grimier end of town, so this one is BRICK and taller:
      //                     three storeys with a stepped parapet, a rooftop water tank on legs, and a
      //                     zig-zag external fire stair up the flank.
      const top = h * 1.25;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, 0, top, pal, seed, night, alpha, true);                          // brick block
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, top, top + h * 0.09, pal, seed + 1, night, alpha, true);         // stepped parapet cap
      { const [tx, ty] = F(-fh * 0.3, -fh * 0.25);                                                              // rooftop water tank on legs
        for (const [lx0, ly0] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) {
          const [lx, ly] = F(-fh * 0.3 + lx0 * fh, -fh * 0.25 + ly0 * fh);
          draw3DBoxAt(ctx, cam, lx, ly, fh * 0.03, top + h * 0.09, top + h * 0.30, 'ty_melt_tank', seed + 70, night, alpha, false);
        }
        drawFacetDrum(ctx, cam, tx, ty, top + h * 0.30, top + h * 0.62, fh * 0.22, fh * 0.22, 10, alpha,
          (f) => { const sh = 0.5 + f.nl * 0.5; return `rgb(${88 * sh | 0},${80 * sh | 0},${70 * sh | 0})`; }, 'rgb(60,54,48)'); }
      { const [fx, fy] = F(fh * 0.95, 0);                                                                       // external fire stair — three zig-zag flights
        for (let k = 0; k < 3; k++) {
          const a = cam.proj(fx, fy, h * (0.2 + k * 0.35)), b = cam.proj(fx, fy + (k % 2 ? -fh * 0.3 : fh * 0.3), h * (0.55 + k * 0.35));
          if (a.f > 0.1 && b.f > 0.1) emitFace(decoDepth(a.f, b.f), () => { ctx.globalAlpha = alpha; ctx.strokeStyle = 'rgba(58,52,48,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); ctx.globalAlpha = 1; });
        } }
      if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh, h * 0.34, m.neon || '#ffb43a', night, alpha);          // sign band low on the frontage, not up top
      if (night) glowPool(ctx, cam, dx, dy, h * 0.3, '255,190,120', 9, alpha * 0.2);
      break;
    }
    case 'bonded': {   // Customs Bonded Store 7 — twin of Dry Store 12 (the same barrel-roof shed). "Bonded"
      //                   means sealed and watched, so this one sits inside a LIT COMPOUND: perimeter fence,
      //                   four corner floodlight masts, a guard box at the gate, and a green customs seal.
      const hw = fh * 1.0, wallTop = h * 0.46, archH = hw * 0.40;
      draw3DBoxAt(ctx, cam, dx, dy, hw, 0, wallTop, pal, seed, night, alpha, false);
      drawBarrelRoof(ctx, cam, F, 0, hw, hw * 0.92, wallTop, archH, 12, alpha, [118, 124, 130]);
      // Perimeter fence — a low run around the compound.
      for (const [ax, ay, bx, by] of [[-1.3, -1.3, 1.3, -1.3], [1.3, -1.3, 1.3, 1.3], [1.3, 1.3, -1.3, 1.3], [-1.3, 1.3, -1.3, -1.3]]) {
        const [p0x, p0y] = F(ax * fh, ay * fh), [p1x, p1y] = F(bx * fh, by * fh);
        const a = cam.proj(p0x, p0y, h * 0.16), b = cam.proj(p1x, p1y, h * 0.16);
        if (a.f > 0.1 && b.f > 0.1) emitFace(decoDepth(a.f, b.f), () => { ctx.globalAlpha = alpha * 0.8; ctx.strokeStyle = 'rgba(70,74,78,0.9)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); ctx.globalAlpha = 1; });
      }
      for (const [sx, sy] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) {   // corner floodlight masts
        const [mx, my] = F(sx * fh, sy * fh);
        draw3DBoxAt(ctx, cam, mx, my, fh * 0.05, 0, h * 0.95, 'ty_bond_fence', seed + 80 + sx * 3 + sy, night, alpha, false);
        if (night) glowPool(ctx, cam, mx, my, h * 0.9, '255,240,200', 10, alpha * 0.34);
      }
      { const [gx, gy] = F(-fh * 0.9, fh * 1.3); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.20, 0, h * 0.26, 'ty_guard', seed + 90, night, alpha, true);
        if (night) glowPool(ctx, cam, gx, gy, h * 0.2, '255,220,160', 5, alpha * 0.3); }                         // guard box at the gate
      if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh, wallTop * 1.04, m.neon || '#6affa8', night, alpha);      // customs seal band
      glowPool(ctx, cam, dx, dy, h * 0.22, '106,255,168', 12, alpha * (night ? 0.28 : 0.14));
      break;
    }
    case 'pawn': {   // Pawn & Pity: grimy box, barred storefront, three hanging pawn spheres, a half-dead sign
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.1, 0, h * 0.72, pal, seed, night, alpha, true);
      { const [gx, gy] = F(0, fh * 0.95); draw3DBoxAt(ctx, cam, gx, gy, fh * 1.0, h * 0.1, h * 0.2, 'ty_door', seed + 1, night, alpha, false); }   // barred storefront band
      { const [px, py] = F(fh * 0.6, fh * 0.55); for (const z of [0.9, 0.78, 0.66]) blinkLight(ctx, cam, px, py, h * z, '255,206,80', now, seed + 20 + z * 10, alpha, 1.5); }   // three hanging spheres
      neonBlade(ctx, cam, dx, dy, h * 0.72, h * 0.98, m.neon || '#ffcf3e', night, alpha);
      if (night) glowPool(ctx, cam, dx, dy, h * 0.24, '210,180,110', 8, alpha * 0.14);               // dim barred-window glow
      break;
    }
    case 'chemsupply': {   // Bulk & Bond: a chem depot — roof storage tank, stacked drums out front, a hazard-green wash
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.25, 0, h * 0.62, pal, seed, night, alpha, true);          // depot shed
      { const [tx, ty] = F(-fh * 0.5, 0); draw3DBoxAt(ctx, cam, tx, ty, fh * 0.34, h * 0.62, h * 0.95, pal, seed + 2, night, alpha, true); }   // roof storage tank
      for (const s of [-0.6, 0, 0.6]) { const [ox, oy] = F(s * fh * 0.7, fh * 0.9); draw3DBoxAt(ctx, cam, ox, oy, fh * 0.2, 0, h * 0.22, 'ty_door', seed + 5 + s * 3, night, alpha, true); }   // drums out front
      neonBlade(ctx, cam, dx, dy, h * 0.62, h * 0.9, m.neon || '#7dff6a', night, alpha);
      glowPool(ctx, cam, dx, dy, h * 0.28, '120,220,120', 12, alpha * (night ? 0.3 : 0.16));         // hazard-green wash
      break;
    }
    // ── The Yards — semi-industrial freight district (docs/proposals/yards.md) ──
    case 'warehouse': {   // long low corrugated-steel shed under a curved barrel roof, roller doors on the street gable
      const hw = fh * 1.12, wallTop = h * 0.5, archH = hw * 0.42;
      draw3DBoxAt(ctx, cam, dx, dy, hw, 0, wallTop, pal, seed, night, alpha, false);                       // ribbed-steel walls (roof capped by the barrel)
      drawBarrelRoof(ctx, cam, F, 0, hw, hw * 0.92, wallTop, archH, 12, alpha, [118, 124, 130]);           // low curved corrugated roof + gables
      if (frontVis) for (const s of [-0.55, 0, 0.55]) { const [gx, gy] = F(s * fh * 1.05, fh * 1.02); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.32, 0, wallTop * 0.7, 'ty_door', seed + 3 + s * 4, night, alpha, false); }   // roller doors
      if (night) glowPool(ctx, cam, dx, dy, wallTop * 0.4, '255,196,120', 12, alpha * 0.16);
      break;
    }
    case 'container_yard': {   // a yard of intermodal boxes stacked in sun-bleached colours (ribbed steel)
      const cols = ['ty_cont_r', 'ty_cont_b', 'ty_cont_g', 'ty_cont_y'];
      const hsh = (a) => { a = (a ^ 61) ^ (a >> 16); a += a << 3; a ^= a >> 4; a = Math.imul(a, 0x27d4eb2d); return (a ^ (a >> 15)) >>> 0; };   // deterministic (no per-frame Math.random flicker)
      for (let gx = -1; gx <= 1; gx++) for (let gy = -1; gy <= 1; gy++) {
        const stack = 1 + hsh(seed + gx * 7 + gy * 13) % 3;                                                // 1..3 boxes high
        const [bx, by] = F(gx * fh * 0.6, gy * fh * 0.6);
        for (let k = 0; k < stack; k++) draw3DBoxAt(ctx, cam, bx, by, fh * 0.26, h * 0.26 * k, h * 0.26 * (k + 1), cols[hsh(seed + gx * 3 + gy + k * 5) & 3], seed + k, night, alpha, true);
      }
      break;
    }
    case 'junkyard': {   // bales of crushed car in uneven rows, a grabber crane over them, a site shack
      const hsh = (a) => { a = (a ^ 61) ^ (a >> 16); a += a << 3; a ^= a >> 4; a = Math.imul(a, 0x27d4eb2d); return (a ^ (a >> 15)) >>> 0; };   // deterministic — no per-frame flicker
      // The stacks: squat, rust-toned, deliberately not squared off like the container yard's.
      for (let gx = -1; gx <= 1; gx++) for (let gy = -1; gy <= 1; gy++) {
        if (gx === 0 && gy === 0) continue;                                                                  // keep the middle clear for the crane
        const stack = 1 + hsh(seed + gx * 11 + gy * 17) % 3;
        const [bx, by] = F(gx * fh * 0.58, gy * fh * 0.58);
        const w = fh * (0.2 + (hsh(seed + gx + gy * 3) % 5) * 0.014);                                        // uneven bale widths
        for (let k = 0; k < stack; k++) {
          draw3DBoxAt(ctx, cam, bx, by, w, h * 0.2 * k, h * 0.2 * (k + 1),
            (hsh(seed + gx * 5 + gy + k * 7) & 1) ? 'ty_junk_bale' : 'ty_junk_bale_dk', seed + k, night, alpha, true);
        }
      }
      // Grabber crane: a lattice mast over the middle with a jib reaching out over the rows.
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.12, 0, h * 1.15, 'ty_junk_crane', seed + 21, night, alpha, true);
      { const [jx, jy] = F(fh * 0.42, 0); draw3DBoxAt(ctx, cam, jx, jy, fh * 0.9, h * 1.0, h * 1.1, 'ty_junk_crane', seed + 22, night, alpha, true); }
      // Site shack at the gate — the only part of this you can actually walk into.
      { const [sx, sy] = F(-fh * 0.55, fh * 0.72); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.42, 0, h * 0.34, pal, seed + 23, night, alpha, true); }
      if (frontVis) { const [gx2, gy2] = F(-fh * 0.55, fh * 0.94); draw3DBoxAt(ctx, cam, gx2, gy2, fh * 0.18, 0, h * 0.22, 'ty_door', seed + 24, night, alpha, false); }
      if (night) glowPool(ctx, cam, dx, dy, 0.02, '255,180,90', 11, alpha * 0.13);                            // one sodium lamp over the gate
      break;
    }
    case 'fuel_yard': {   // a cluster of squat cylindrical storage tanks + a low pallet stack
      const steel = (r, g, b) => (f) => { const sh = 0.5 + f.nl * 0.5; return `rgb(${r * sh | 0},${g * sh | 0},${b * sh | 0})`; };
      const tankStyle = steel(150, 148, 140);
      for (const [sx, sy, r, tz] of [[-0.5, -0.3, 0.34, 0.7], [0.45, -0.35, 0.28, 0.55], [0.1, 0.45, 0.3, 0.62]]) {
        const [tx, ty] = F(sx * fh, sy * fh);
        drawFacetDrum(ctx, cam, tx, ty, 0, h * tz, fh * r, fh * r, 12, alpha, tankStyle, 'rgb(120,120,112)');   // vertical cylinder, flat cap
        drawRing(ctx, cam, tx, ty, h * tz * 0.6, fh * r + 0.003, 12, 'rgba(0,0,0,0.25)', 1, alpha);             // seam band
      }
      { const [px, py] = F(-fh * 0.1, fh * 0.7); draw3DBoxAt(ctx, cam, px, py, fh * 0.4, 0, h * 0.16, pal, seed + 4, night, alpha, true); }   // low pallet stack
      if (night) glowPool(ctx, cam, dx, dy, 0.02, '255,180,90', 10, alpha * 0.14);
      break;
    }
    case 'cold_storage': {   // windowless insulated block, rooftop condenser units, a cold blue breath
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.08, 0, h * 0.7, pal, seed, night, alpha, true);                 // insulated metal block
      for (const s of [-0.5, 0, 0.5]) { const [cx, cy] = F(s * fh * 0.6, -fh * 0.2); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.2, h * 0.7, h * 0.85, 'ty_cold_unit', seed + 3 + s * 3, night, alpha, true); }   // rooftop condensers
      if (frontVis) { const [gx, gy] = F(0, fh * 1.02); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.4, 0, h * 0.38, 'ty_door', seed + 1, night, alpha, false); }   // loading-dock door
      glowPool(ctx, cam, dx, dy, h * 0.34, '150,200,230', 12, alpha * (night ? 0.3 : 0.16));               // cold breath
      break;
    }
    case 'fabrication': {   // open fab shed straddled by a gantry crane, a smoking flue + welding spark glow
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.08, 0, h * 0.55, pal, seed, night, alpha, true);                // shed
      for (const s of [-1, 1]) { const [lx, ly] = F(s * fh * 0.8, 0); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.06, 0, h * 0.85, 'ty_fab_steel', seed + s + 2, night, alpha, false); }   // gantry legs
      { const [l0x, l0y] = F(-fh * 0.8, 0), [l1x, l1y] = F(fh * 0.8, 0); const a = cam.proj(l0x, l0y, h * 0.85), b = cam.proj(l1x, l1y, h * 0.85);
        if (a.f > 0.1 && b.f > 0.1) emitFace(decoDepth(a.f, b.f), () => { ctx.globalAlpha = alpha; ctx.strokeStyle = 'rgba(90,96,104,0.95)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); ctx.globalAlpha = 1; }); }   // crane spanning beam
      { const [fx, fy] = F(fh * 0.55, -fh * 0.3); drawSmoke(ctx, cam, fx, fy, h * 0.55, '90,86,80', alpha * 0.7, now, seed + 5); }   // flue smoke
      if (night) glowPool(ctx, cam, dx, dy, h * 0.2, '255,150,70', 10, alpha * 0.24);                       // welding spark glow
      break;
    }
    case 'garage': {   // Halloran's Fix-It: a low grease-and-steel repair shop — three roll-up bays under a lit name
      //                  band, an engine-hoist jib over the forecourt, a rooftop extractor, warm worklight from the bays
      const wall = h * 0.5;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, 0, wall, pal, seed, night, alpha, true);                     // workshop block
      if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh, wall * 1.02, m.neon || '#ffb14a', night, alpha);   // lit name band over the bays
      if (frontVis) for (const s of [-0.62, 0, 0.62]) { const [bx, by] = F(s * fh, fh * 1.03); draw3DBoxAt(ctx, cam, bx, by, fh * 0.26, 0, wall * 0.72, 'ty_garage_bay', seed + 4 + s * 5, night, alpha, false); }   // roll-up bay doors
      { const [mx, my] = F(fh * 0.55, fh * 0.35); draw3DBoxAt(ctx, cam, mx, my, fh * 0.05, 0, wall * 1.5, 'ty_fab_steel', seed + 2, night, alpha, false);   // engine-hoist post
        const top = cam.proj(mx, my, wall * 1.5), [jx, jy] = F(fh * 0.55, fh * 1.1), jib = cam.proj(jx, jy, wall * 1.22);
        if (top.f > 0.1 && jib.f > 0.1) emitFace(decoDepth(top.f, jib.f), () => { ctx.globalAlpha = alpha; ctx.strokeStyle = 'rgba(80,84,92,0.95)'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(top.sx, top.sy); ctx.lineTo(jib.sx, jib.sy); ctx.stroke(); ctx.globalAlpha = 1; }); }   // hoist jib over the forecourt
      { const [vx, vy] = F(-fh * 0.4, -fh * 0.3); draw3DBoxAt(ctx, cam, vx, vy, fh * 0.14, wall, wall + h * 0.14, 'ty_fab_steel', seed + 6, night, alpha, true);
        drawSmoke(ctx, cam, vx, vy, wall + h * 0.14, '110,104,96', alpha * 0.5, now, seed + 7); }           // rooftop extractor vent
      if (night) { glowPool(ctx, cam, dx, dy, wall * 0.3, '255,170,90', 11, alpha * 0.26);                  // warm worklight
        for (const s of [-0.62, 0, 0.62]) { const [bx, by] = F(s * fh, fh * 1.03); glowPool(ctx, cam, bx, by, wall * 0.18, '255,180,100', 5, alpha * 0.3); } }   // bay-door light spill
      break;
    }
    case 'wharf': {   // low open-sided transfer shed with a cantilevered loading crane reaching over the water
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, 0, h * 0.44, pal, seed, night, alpha, true);                // shed
      const [mx, my] = F(-fh * 0.4, -fh * 0.2); draw3DBoxAt(ctx, cam, mx, my, fh * 0.08, 0, h * 1.2, 'ty_wharf_steel', seed + 2, night, alpha, false);   // crane mast
      { const top = cam.proj(mx, my, h * 1.2), [jx, jy] = F(fh * 0.5, fh * 0.9), jib = cam.proj(jx, jy, h * 0.75);
        if (top.f > 0.1 && jib.f > 0.1) emitFace(decoDepth(top.f, jib.f), () => { ctx.globalAlpha = alpha; ctx.strokeStyle = 'rgba(70,76,84,0.95)'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(top.sx, top.sy); ctx.lineTo(jib.sx, jib.sy); ctx.stroke(); ctx.globalAlpha = 1; }); }   // jib over the water
      blinkLight(ctx, cam, mx, my, h * 1.2, '255,90,70', now, seed, alpha, 1.5);                            // crane tip light
      break;
    }
    case 'freight_office': {   // a small two-storey site office with a lit sign band and a service canopy
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.95, 0, h * 0.85, pal, seed, night, alpha, true);                // office block
      if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh, h * 0.9, m.neon || '#ffb43a', night, alpha);      // sign band
      { const [cx, cy] = F(0, fh * 0.92); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.7, h * 0.16, h * 0.26, 'ty_door', seed + 1, night, alpha, false); }   // service canopy
      if (night) glowPool(ctx, cam, dx, dy, h * 0.3, '255,200,120', 9, alpha * 0.2);
      break;
    }
    case 'freight_forwarder': {   // a forwarding depot with a loading-dock canopy and truck bays facing the apron
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.08, 0, h * 0.6, pal, seed, night, alpha, true);                 // depot shed
      { const [cx, cy] = F(0, fh * 1.05); draw3DBoxAt(ctx, cam, cx, cy, fh * 1.02, h * 0.42, h * 0.5, 'ty_door', seed + 1, night, alpha, false); }   // loading-dock canopy
      if (frontVis) for (const s of [-0.6, 0, 0.6]) { const [bx, by] = F(s * fh, fh * 1.02); draw3DBoxAt(ctx, cam, bx, by, fh * 0.28, 0, h * 0.34, 'ty_door', seed + 4 + s * 3, night, alpha, false); }   // truck bays
      if (night) glowPool(ctx, cam, dx, dy, h * 0.3, '255,196,120', 12, alpha * 0.18);
      break;
    }
    case 'asc_spire': {   // The Spire: a chrome helix twisting harder than Halcyon, in Ascendant blue,
      //                    with the calm-eye seal glowing on the plaza at its foot.
      const asc = '74,168,255';
      const baseZ = h * 0.24, topZ = h * 3.0, N = 24;
      const twist = 1.8, fwBase = fh * 0.78;
      const segZ = (i) => baseZ + (topZ - baseZ) * (i / N);
      const segW = (i) => fwBase * (1 - 0.5 * (i / N));
      const segYaw = (i) => twist * (i / N);
      glowPool(ctx, cam, dx, dy, 0.02, asc, 14, alpha * (night ? 0.5 : 0.28));                 // the calm-eye seal on the plaza
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.28, 0, baseZ, pal, seed + 4, night, alpha, true);   // podium
      { const [cx, cy] = F(0, fh * 1.04); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.8, h * 0.1, h * 0.22, 'ty_door', seed + 5, night, alpha, false); }
      for (let i = 0; i < N; i++) draw3DBoxAt(ctx, cam, dx, dy, segW(i), segZ(i), segZ(i + 1), pal, seed + i, night, alpha, i === N - 1, segYaw(i));
      for (const dir of [[-1, -1], [1, 1]]) {   // spiralling Ascendant-blue corner light-runners
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const w = segW(Math.min(i, N - 1)), ya = segYaw(i), cw = Math.cos(ya), sw = Math.sin(ya), lx = dir[0] * w, ly = dir[1] * w;
          const p = cam.proj(dx + lx * cw - ly * sw, dy + lx * sw + ly * cw, segZ(i));
          if (p.f > 0.12) pts.push(p);
        }
        if (pts.length > 1) emitFace(decoDepth(...pts.map(p => p.f)), () => {
          ctx.save(); ctx.globalAlpha = alpha * (night ? 0.95 : 0.5);
          ctx.strokeStyle = `rgba(${asc},0.9)`; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
          if (night) { ctx.shadowColor = `rgb(${asc})`; ctx.shadowBlur = 8; }
          ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.stroke();
          ctx.shadowBlur = 0; ctx.restore();
        });
      }
      draw3DBoxAt(ctx, cam, dx, dy, segW(N) * 0.9, topZ, topZ + h * 0.22, pal, seed + 20, night, alpha, true, twist * 1.06);   // crown
      mast(ctx, cam, dx, dy, topZ + h * 0.22, topZ + h * 0.6, alpha, now, seed);
      if (night) { glowPool(ctx, cam, dx, dy, baseZ, asc, 24, alpha * 0.3); glowPool(ctx, cam, dx, dy, topZ + h * 0.08, asc, 16, alpha * 0.3); }
      blinkLight(ctx, cam, dx, dy, topZ + h * 0.6, asc, now, seed, alpha, 2);
      break;
    }
    case 'asc_gate': {   // The Ascension Gate: a low fortified chrome slab — flanking pylons, two turret
      //                   housings that track (red blink), and a bright scanline across the frontage.
      const asc = '74,168,255';
      const wall = h * 0.9;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.15, 0, wall, pal, seed, night, alpha, true);                        // main slab
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.2, wall, wall + h * 0.12, pal, seed + 1, night, alpha, true);       // parapet cap
      for (const s of [-1, 1]) { const [px, py] = F(s * fh * 1.0, fh * 1.0); draw3DBoxAt(ctx, cam, px, py, fh * 0.16, 0, wall * 1.25, pal, seed + 2 + (s > 0 ? 1 : 0), night, alpha, true); }   // flanking pylons
      for (const s of [-1, 1]) {   // turret housings + red tracking blink
        const [tx, ty] = F(s * fh * 0.55, fh * 0.2);
        draw3DBoxAt(ctx, cam, tx, ty, fh * 0.14, wall + h * 0.12, wall + h * 0.26, 'ty_door', seed + 4 + (s > 0 ? 1 : 0), night, alpha, true);
        blinkLight(ctx, cam, tx, ty, wall + h * 0.3, '255,90,80', now, seed + (s > 0 ? 2 : 1), alpha, 1.4);
      }
      if (frontVis) { const [gx, gy] = F(0, fh * 1.06); glowPool(ctx, cam, gx, gy, wall * 0.5, asc, 12, alpha * (night ? 0.6 : 0.35)); }   // scanline wash
      break;
    }
    case 'asc_clinic': {   // Chrome Clinic: a clean pale block, set-back upper, cyan clinical glow + roof emblem.
      const asc = '120,220,255';
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.1, 0, h * 0.7, pal, seed, night, alpha, true);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.7, h * 0.7, h * 0.9, pal, seed + 1, night, alpha, true);            // set-back upper
      { const [cx, cy] = F(0, fh * 1.02); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.7, h * 0.06, h * 0.18, 'ty_door', seed + 2, night, alpha, false); }
      { const [ex, ey] = F(0, 0); draw3DBoxAt(ctx, cam, ex, ey, fh * 0.12, h * 0.9, h * 1.0, 'ty_door', seed + 3, night, alpha, true); glowPool(ctx, cam, ex, ey, h * 0.98, asc, 6, alpha * (night ? 0.7 : 0.4)); }   // roof emblem
      if (night) glowPool(ctx, cam, dx, dy, h * 0.2, asc, 12, alpha * 0.25);
      break;
    }
    case 'asc_weave': {   // The Weave: an open fab shed straddled by a gantry, a smoking flue, welding-spark glow.
      const spark = '255,180,90';
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.15, 0, h * 0.6, pal, seed, night, alpha, true);                     // shed
      for (const s of [-1, 1]) { const [lx, ly] = F(s * fh * 0.95, 0); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.08, h * 0.6, h * 0.95, pal, seed + 1 + (s > 0 ? 1 : 0), night, alpha, false); }   // gantry legs
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.05, h * 0.88, h * 0.95, pal, seed + 3, night, alpha, false);        // gantry span
      { const [fx, fy] = F(-fh * 0.6, -fh * 0.4); draw3DBoxAt(ctx, cam, fx, fy, fh * 0.12, h * 0.6, h * 1.1, 'ty_door', seed + 4, night, alpha, true); drawSmoke(ctx, cam, fx, fy, h * 1.1, '150,150,150', alpha * 0.4, now, seed + 5); }   // flue + smoke
      if (frontVis) { const [gx, gy] = F(0, fh * 1.0); glowPool(ctx, cam, gx, gy, 0.02, spark, 12, alpha * (night ? 0.5 : 0.3)); }   // spark spill
      break;
    }
    case 'asc_vats': {   // The Vats: a windowless steel drum, coolant frost-band, vent pipes, cold base breath.
      const cold = '120,200,255';
      const steel = WALL_COL[pal] || [88, 102, 118];
      const skin = (f) => { const s = 0.5 + f.nl * 0.55; return `rgba(${steel[0] * s | 0},${steel[1] * s | 0},${steel[2] * s | 0},0.97)`; };
      const cap = night ? 'rgba(40,52,64,0.97)' : 'rgba(150,168,186,0.97)';
      drawFacetDrum(ctx, cam, dx, dy, 0, h * 1.1, fh * 0.95, fh * 0.9, 12, alpha, skin, cap);                  // the drum
      for (const s of [-1, 1]) { const [px, py] = F(s * fh * 0.4, 0); draw3DBoxAt(ctx, cam, px, py, fh * 0.1, h * 1.1, h * 1.35, 'ty_door', seed + 1 + (s > 0 ? 1 : 0), night, alpha, true); }   // vent pipes
      drawRing(ctx, cam, dx, dy, h * 0.55, fh * 0.97, 12, `rgba(${cold},${night ? 0.7 : 0.35})`, 1.4, alpha);  // coolant band
      glowPool(ctx, cam, dx, dy, 0.02, cold, 14, alpha * (night ? 0.55 : 0.3));                                // cold breath at the base
      break;
    }
    case 'asc_shrine': {   // Architect Shrine: a black-glass slab leaning on the Curtain, server-rack glow,
      //                     and a vertical uplink light-beam to the sky.
      const asc = '74,168,255';
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.95, 0, h * 1.5, pal, seed, night, alpha, true);                     // tall slab
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.1, 0, h * 0.2, pal, seed + 1, night, alpha, true);                  // base
      { const [wx, wy] = F(-fh * 0.9, 0); glowPool(ctx, cam, wx, wy, h * 0.8, asc, 10, alpha * (night ? 0.6 : 0.35)); }   // server-rack glow, Curtain side
      mast(ctx, cam, dx, dy, h * 1.5, h * 2.1, alpha, now, seed);
      emitFace(decoDepth(cam.proj(dx, dy, h * 1.5).f), () => {   // uplink beam
        const a = cam.proj(dx, dy, h * 1.5), b = cam.proj(dx, dy, h * 2.6);
        if (a.f > 0.1 && b.f > 0.1) {
          ctx.save(); ctx.globalAlpha = alpha * (night ? 0.8 : 0.4); ctx.strokeStyle = `rgba(${asc},0.85)`; ctx.lineWidth = 2.4;
          if (night) { ctx.shadowColor = `rgb(${asc})`; ctx.shadowBlur = 10; }
          ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); ctx.shadowBlur = 0; ctx.restore();
        }
      });
      blinkLight(ctx, cam, dx, dy, h * 2.6, asc, now, seed, alpha, 2);
      break;
    }
    case 'stimcafe': {   // Battery Acid Coffee Co. — a narrow cafe with the roasting drum ON THE ROOF, smoking all day
      const wallTop = h * 0.96;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, 0, wallTop, pal, seed, night, alpha, true);
      // The roaster: a riveted drum on its cradle, venting roast smoke. The whole street smells of it.
      // drawFacetDrum's 11th arg is a STYLE FUNCTION, not a palette key — passing `pal` here threw
      // "style is not a function" and killed the render loop the moment this cafe came into view.
      // Same shading idiom as asc_vats: base RGB off the palette, lit per facet normal.
      const roast = WALL_COL[pal] || [58, 54, 48];
      const roastSkin = (f) => { const s = 0.5 + f.nl * 0.55; return `rgba(${roast[0] * s | 0},${roast[1] * s | 0},${roast[2] * s | 0},0.97)`; };
      drawFacetDrum(ctx, cam, dx, dy, wallTop, wallTop + h * 0.30, fh * 0.30, fh * 0.26, 10, alpha, roastSkin, night ? 'rgba(36,32,28,0.97)' : 'rgba(96,88,78,0.97)');
      drawSmoke(ctx, cam, dx, dy, wallTop + h * 0.30, '160,140,120', alpha * 0.5, now, seed + 2);
      { const [ax, ay] = F(0, fh * 0.98); draw3DBoxAt(ctx, cam, ax, ay, fh * 1.00, wallTop * 0.60, wallTop * 0.68, 'ty_door', seed + 1, night, alpha, false); }   // awning over the pavement tables
      if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.90, wallTop * 0.80, m.neon || '#5fd0ff', night, alpha, 'BATTERY ACID');
      if (night) { const [wx, wy] = F(0, fh * 0.94); glowPool(ctx, cam, wx, wy, h * 0.24, '255,205,150', 12, alpha * 0.30); }
      break;
    }
    case 'permits': {   // Office of Permitted Suffering — a blank civic slab whose only architectural feature is the queue canopy
      const body = h * 1.10;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.10, 0, body, pal, seed, night, alpha, true);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.16, body * 0.06, body * 0.14, 'ty_door', seed + 1, night, alpha, false);   // a mean plinth band
      // The queue canopy — a long low shelter running out from the door, because the
      // waiting is the building's real function. It is longer than the entrance is wide.
      { const [cx, cy] = F(0, fh * 1.55); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.34, body * 0.28, body * 0.34, 'ty_door', seed + 2, night, alpha, false);
        for (let i = 0; i < 4; i++) { const [px, py] = F(fh * 0.26 * (i % 2 ? 1 : -1), fh * (0.95 + i * 0.30));
          draw3DBoxAt(ctx, cam, px, py, fh * 0.04, 0, body * 0.28, 'ty_door', seed + 20 + i, night, alpha, false); } }   // canopy posts
      if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 1.00, body * 0.62, m.neon || '#9ab08a', night, alpha, 'PERMITS');
      // One lit window at the top, night or day: somebody up there is still processing forms.
      { const [wx, wy] = F(fh * 0.55, fh * 1.12); glowPool(ctx, cam, wx, wy, body * 0.86, '210,225,180', 5, alpha * (night ? 0.42 : 0.18)); }
      break;
    }
    case 'rationnine': {   // Ration Nine — a state ration depot: roller shutter, stacked crates, and a stencilled 9 the size of a door
      const wallTop = h * 0.90;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.04, 0, wallTop, pal, seed, night, alpha, true);
      { const [sx, sy] = F(0, fh * 1.06); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.62, 0, wallTop * 0.58, 'ty_door', seed + 1, night, alpha, false); }   // the roller shutter, half down
      for (let i = 0; i < 3; i++) {   // delivery crates nobody has taken in yet
        const [bx, by] = F((-0.8 + i * 0.8) * fh * 0.72, fh * 1.22);
        draw3DBoxAt(ctx, cam, bx, by, fh * 0.20, 0, h * (0.14 + 0.05 * (i & 1)), 'ty_door', seed + 8 + i, night, alpha, true);
      }
      // The stencilled 9, painted straight onto the wall as surface text — it leans and
      // foreshortens with the face, never billboards.
      if (frontVis) {
        const nhw = fh * 0.30, z0 = wallTop * 0.62, z1 = wallTop * 0.96;
        const [lx, ly] = F(-nhw - fh * 0.4, fh * 1.05), [rx, ry] = F(nhw - fh * 0.4, fh * 1.05);
        const TL = cam.proj(lx, ly, z1), TR = cam.proj(rx, ry, z1), BR = cam.proj(rx, ry, z0), BL = cam.proj(lx, ly, z0);
        if ([TL, TR, BR, BL].every(p => p.f > 0.12)) {
          const tex = bakeSignText('9', '#d8d2c0', night ? 1 : 0, false);
          emitFace(decoDepth(TL.f, TR.f, BR.f, BL.f), () => drawSurfaceText(ctx, TL, TR, BR, BL, tex, false, alpha * 0.9));
        }
        marqueeBand(ctx, cam, dx, dy, E, fh * 0.96, wallTop * 0.74, m.neon || '#ffb43a', night, alpha, 'RATION NINE');
      }
      if (night) { const [wx, wy] = F(0, fh * 1.02); glowPool(ctx, cam, wx, wy, h * 0.18, '255,200,140', 10, alpha * 0.22); }
      break;
    }
    // ── Marrow Street, the workaday downtown strip ────────────────────────────
    // Deliberately LOW and cluttered where the rest of the skyline is tall and clean:
    // these read as a high street from the air because of what's on the pavement and
    // venting off the roof, not because of height. The Sentinel anchors the row.
    case 'deptstore': {   // Adequate! — a four-floor discount slab wearing one enormous banner, plant all over the roof
      const body = h * 1.28;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.24, 0, body, pal, seed, night, alpha, true);
      const banZ0 = body * 0.70, banZ1 = body * 0.86;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.30, banZ0, banZ1, 'ty_door', seed + 1, night, alpha, false);   // the banner, wrapping the whole facade
      roofClutter(ctx, cam, dx, dy, fh * 1.24, body, 'citycore', seed + 2, night, alpha, now);
      // "ADEQUATE!" painted the full width of the banner. The zone prose promises letters
      // tall enough to read from the water, so it's surface text on the banner's real quad
      // — it leans and foreshortens with the face instead of billboarding at the camera.
      if (frontVis) {
        const bhw = fh * 1.14, [blx, bly] = F(-bhw, fh * 1.32), [brx, bry] = F(bhw, fh * 1.32);
        const TL = cam.proj(blx, bly, banZ1 - body * 0.012), TR = cam.proj(brx, bry, banZ1 - body * 0.012);
        const BR = cam.proj(brx, bry, banZ0 + body * 0.012), BL = cam.proj(blx, bly, banZ0 + body * 0.012);
        if ([TL, TR, BR, BL].every(p => p.f > 0.12)) {
          const tex = bakeSignText('ADEQUATE!', m.neon || '#ff8a2e', night ? 1 : 0, false);
          emitFace(decoDepth(TL.f, TR.f, BR.f, BL.f), () => drawSurfaceText(ctx, TL, TR, BR, BL, tex, false, alpha));
        }
        const [nx, ny] = F(fh * 0.70, fh * 1.02); neonBlade(ctx, cam, nx, ny, body * 0.88, body + h * 0.34, m.neon || '#ff8a2e', night, alpha);
      }
      { const [bx, by] = F(fh * 0.90, -fh * 0.60); blinkLight(ctx, cam, bx, by, body + h * 0.03, '255,150,90', now, seed + 9, alpha, 1.8); }   // one roof bulb nobody ever fixed
      if (night) { const [wx, wy] = F(0, fh * 1.06); glowPool(ctx, cam, wx, wy, h * 0.16, '255,190,120', 16, alpha * 0.30); }   // the mannequin windows
      break;
    }
    case 'hardware': {   // Nuts to That — a low shop under a deep awning with its stock stacked out on the pavement
      const wallTop = h * 0.86;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.08, 0, wallTop, pal, seed, night, alpha, true);
      { const [ax, ay] = F(0, fh * 1.02); draw3DBoxAt(ctx, cam, ax, ay, fh * 1.18, wallTop * 0.66, wallTop * 0.74, 'ty_door', seed + 1, night, alpha, false); }   // the deep awning
      for (let i = 0; i < 3; i++) {   // rope coils, the rebar barrel, a pallet of grey buckets
        const [sx, sy] = F((-0.7 + i * 0.7) * fh * 0.80, fh * 1.16);
        draw3DBoxAt(ctx, cam, sx, sy, fh * 0.22, 0, h * (0.16 + 0.06 * (i & 1)), 'ty_door', seed + 5 + i, night, alpha, true);
      }
      roofClutter(ctx, cam, dx, dy, fh * 1.08, wallTop, 'citycore', seed + 4, night, alpha, now);   // vents and a water tank break the flat roof
      if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 1.02, wallTop * 0.86, m.neon || '#ffcf3e', night, alpha, 'NUTS TO THAT');
      break;
    }
    case 'bathhouse': {   // Lather & Lye — a low tiled bathhouse venting steam off the roof all day. The steam IS the sign.
      const wallTop = h * 0.92;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, 0, wallTop, pal, seed, night, alpha, true);
      for (const s of [-1, 1]) {
        const [vx, vy] = F(s * fh * 0.42, -fh * 0.20);
        draw3DBoxAt(ctx, cam, vx, vy, fh * 0.16, wallTop, wallTop + h * 0.16, 'ty_door', seed + 2 + s, night, alpha, true);
        drawSmoke(ctx, cam, vx, vy, wallTop + h * 0.16, '210,225,230', alpha * 0.55, now, seed + s);
        // Backlight the plume from the vent mouth, so at night the steam is a lit column
        // off the roof rather than grey smudges — the one thing you can see this place by.
        glowPool(ctx, cam, vx, vy, wallTop + h * 0.14, '170,240,225', 7, alpha * (night ? 0.34 : 0.12));
      }
      { const [px, py] = F(-fh * 0.70, fh * 1.04); draw3DBoxAt(ctx, cam, px, py, fh * 0.07, h * 0.10, h * 0.60, 'ty_marble_col', seed + 7, night, alpha, false); }   // the barber's pole
      if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 1.00, wallTop * 0.80, m.neon || '#7fe3c0', night, alpha, 'LATHER & LYE');
      if (night) { const [wx, wy] = F(0, fh * 1.00); glowPool(ctx, cam, wx, wy, h * 0.20, '150,235,215', 12, alpha * 0.26); }
      break;
    }
    case 'noodlebar': {   // Oyelaran's — one storey, front wall folded open, a steam hood dumping the entire advertising budget into the street
      const wallTop = h * 0.74;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.90, 0, wallTop, pal, seed, night, alpha, true);
      { const [ax, ay] = F(0, fh * 0.98); draw3DBoxAt(ctx, cam, ax, ay, fh * 1.02, wallTop * 0.52, wallTop * 0.62, 'ty_door', seed + 1, night, alpha, false); }   // the counter awning over the open front
      { const [hx, hy] = F(0, -fh * 0.10);
        draw3DBoxAt(ctx, cam, hx, hy, fh * 0.30, wallTop, wallTop + h * 0.20, 'ty_door', seed + 2, night, alpha, true);
        drawSmoke(ctx, cam, hx, hy, wallTop + h * 0.20, '225,215,200', alpha * 0.60, now, seed + 3); }   // the steam hood
      if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.86, wallTop * 0.74, m.neon || '#ff5a3e', night, alpha, "OYELARAN'S");
      // A row of paper lanterns strung the length of the open front — nine stools, nine lamps.
      for (let i = 0; i < 4; i++) {
        const [lx, ly] = F((-0.72 + i * 0.48) * fh * 0.86, fh * 1.00);
        draw3DBoxAt(ctx, cam, lx, ly, fh * 0.045, wallTop * 0.66, wallTop * 0.76, 'ty_door', seed + 12 + i, night, alpha, false);
        glowPool(ctx, cam, lx, ly, wallTop * 0.70, '255,170,95', 4, alpha * (night ? 0.46 : 0.20));
      }
      if (night) {
        const [lx, ly] = F(fh * 0.55, fh * 1.00); glowPool(ctx, cam, lx, ly, wallTop * 0.80, '255,180,110', 7, alpha * 0.40);    // the paper lantern
        const [wx, wy] = F(0, fh * 0.96); glowPool(ctx, cam, wx, wy, wallTop * 0.45, '255,196,130', 12, alpha * 0.34);            // nine lit stools
      }
      break;
    }
    case 'outfitter': {   // Layers — a narrow workwear shopfront with boots strung up under the awning by their laces
      const wallTop = h * 0.94;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, 0, wallTop, pal, seed, night, alpha, true);
      { const [ax, ay] = F(0, fh * 0.98); draw3DBoxAt(ctx, cam, ax, ay, fh * 1.04, wallTop * 0.60, wallTop * 0.68, 'ty_door', seed + 1, night, alpha, false); }
      for (let i = 0; i < 4; i++) {   // the hanging boots
        const [bx, by] = F((-0.75 + i * 0.50) * fh * 0.90, fh * 1.02);
        draw3DBoxAt(ctx, cam, bx, by, fh * 0.05, wallTop * 0.44, wallTop * 0.58, 'ty_door', seed + 6 + i, night, alpha, false);
      }
      for (const s of [-1, 1]) {   // two headless forms in the window, each in this season's one coat
        const [mx, my] = F(s * fh * 0.34, fh * 0.86);
        draw3DBoxAt(ctx, cam, mx, my, fh * 0.09, h * 0.06, h * 0.42, 'ty_marble_col', seed + 14 + s, night, alpha, false);
      }
      if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.88, wallTop * 0.82, m.neon || '#ffb43a', night, alpha, 'LAYERS');
      if (night) { const [wx, wy] = F(0, fh * 0.96); glowPool(ctx, cam, wx, wy, h * 0.22, '255,200,140', 11, alpha * 0.24); }
      break;
    }
    case 'bodega': {   // Bodega Vu — a tiny corner shop with awnings on BOTH streets, one warm window and a padlocked cooler outside
      const wallTop = h * 0.82;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.90, 0, wallTop, pal, seed, night, alpha, true);
      { const [ax, ay] = F(0, fh * 0.96); draw3DBoxAt(ctx, cam, ax, ay, fh * 0.98, wallTop * 0.58, wallTop * 0.66, 'ty_door', seed + 1, night, alpha, false); }
      { const [bx, by] = F(fh * 0.96, 0); draw3DBoxAt(ctx, cam, bx, by, fh * 0.98, wallTop * 0.58, wallTop * 0.66, 'ty_door', seed + 2, night, alpha, false); }   // it turns the corner — that's the whole building
      { const [cx, cy] = F(-fh * 0.60, fh * 1.00); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.14, 0, h * 0.24, 'ty_door', seed + 3, night, alpha, true); }              // the chained cooler
      for (let i = 0; i < 2; i++) {   // produce crates out on the pavement, stacked two high
        const [kx, ky] = F((0.30 + i * 0.34) * fh, fh * 1.06);
        draw3DBoxAt(ctx, cam, kx, ky, fh * 0.13, 0, h * (0.12 + 0.07 * i), 'ty_door', seed + 16 + i, night, alpha, true);
      }
      if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.84, wallTop * 0.78, m.neon || '#ffe08a', night, alpha, 'BODEGA VU');
      if (night) { const [wx, wy] = F(0, fh * 0.94); glowPool(ctx, cam, wx, wy, h * 0.20, '255,215,150', 10, alpha * 0.30); }
      break;
    }
    case 'sentinel': {   // Coldwater Sentinel — a narrow storefront newsroom under a guyed press mast, its window a wall of feed-screens
      const body = h * 1.02;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, 0, body, pal, seed, night, alpha, true);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, body * 0.74, body * 0.84, 'ty_door', seed + 1, night, alpha, false);   // the stencilled masthead band
      mast(ctx, cam, dx, dy, body, body + h * 0.62, alpha, now, seed);                                                // how the news actually gets out
      roofClutter(ctx, cam, dx, dy, fh * 0.96, body, 'citycore', seed + 2, night, alpha, now);
      if (frontVis) { const [nx, ny] = F(fh * 0.52, fh * 1.00); neonBlade(ctx, cam, nx, ny, body * 0.80, body + h * 0.30, m.neon || '#5fd0ff', night, alpha); }
      if (night) { const [wx, wy] = F(0, fh * 1.00); glowPool(ctx, cam, wx, wy, h * 0.24, '120,200,255', 13, alpha * 0.34); }   // feed-screens through the glass
      break;
    }
    case 'shop':
    default: {   // small mixed-use storefront: a glazed lit ground floor + residential floors above + awning + sign
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.0, 0, h * 0.4, 'ty_office', seed, night, alpha, true);      // glazed ground-floor retail (glass tone)
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, h * 0.4, h * 1.0, pal, seed + 2, night, alpha, true);    // residential floors above
      { const [gx, gy] = F(0, fh * 0.92); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.98, h * 0.32, h * 0.44, 'ty_door', seed + 1, night, alpha, false); }   // awning over the storefront
      { const [nx, ny] = F(fh * 0.55, fh * 0.55); neonBlade(ctx, cam, nx, ny, h * 0.44, h * 1.12, m.neon || '#5fd0ff', night, alpha); }   // projecting sign on the storefront corner (over the awning, cresting the roofline) — not a stub planted in the roof centre
      if (night) { const [wx, wy] = F(0, fh * 0.9); glowPool(ctx, cam, wx, wy, h * 0.2, '150,220,255', 10, alpha * 0.24); }   // lit storefront glow
      break;
    }
  }
}

// ── Shape capture harness ────────────────────────────────────────────────────
// Runs the REAL drawTypeModel above against a stub ctx/cam with SHAPE_SINK installed, and returns
// the mass segments it would have drawn. See the SHAPE_SINK block near emitFace for why this exists
// and why it can't affect a rendered frame.
//
// KNOWN GAP, DELIBERATE. Two arms build revolved shells by hand out of cam.proj + emitFace rather
// than a mass primitive — the bank's stone dome and the Meridian's ogee cupola — so capture misses
// them. Both are subsumed by an adjacent captured box in BOTH the height envelope (each is
// immediately followed by a lantern/finial box starting at the shell's apex) and the footprint hull
// (each shell is far narrower than the stylobate/shaft below it). Collision and shadow error is
// therefore exactly zero; the only loss is wireframe contour. Don't "fix" this without a reason.

// A ctx that answers every call the arms make and does nothing. Deliberately a plain object and NOT
// a Proxy: a Proxy that auto-returns functions would silently swallow a genuine typo, whereas this
// throws loudly the first time an arm reaches for something new — which is exactly when we want to
// hear about it.
const SHAPE_STUB_GRAD = { addColorStop() {} };
// Counts the two canvas operations that actually cost real time — building a gradient, and setting
// shadowBlur (a software blur pass per draw). Face count turned out to be a poor proxy for cost, so
// the bake measures the expensive ops directly instead.
const SHAPE_STUB_COST = { grads: 0, blurs: 0 };
const SHAPE_STUB_CTX = {
  globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '',
  shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0, font: '', textAlign: '',
  textBaseline: '', globalCompositeOperation: '', filter: '', miterLimit: 10,
  save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {},
  arcTo() {}, ellipse() {}, roundRect() {}, quadraticCurveTo() {}, bezierCurveTo() {}, rect() {},
  fill() {}, stroke() {}, clip() {}, setLineDash() {}, getLineDash() { return []; },
  fillRect() {}, strokeRect() {}, clearRect() {}, fillText() {}, strokeText() {},
  translate() {}, rotate() {}, scale() {}, setTransform() {}, resetTransform() {}, transform() {},
  drawImage() {}, measureText() { return { width: 0 }; },
  createLinearGradient() { SHAPE_STUB_COST.grads++; return SHAPE_STUB_GRAD; },
  createRadialGradient() { SHAPE_STUB_COST.grads++; return SHAPE_STUB_GRAD; },
  createConicGradient() { SHAPE_STUB_COST.grads++; return SHAPE_STUB_GRAD; }, createPattern() { return null; },
};
// shadowBlur is a plain property everywhere else, so count it with a setter rather than a method.
Object.defineProperty(SHAPE_STUB_CTX, 'shadowBlur', {
  get() { return 0; }, set(v) { if (v) SHAPE_STUB_COST.blurs++; },
});
// Heading 0, no chase offset. The constant f = 4 clears every `f > 0.1 / 0.12 / 0.08` guard in the
// arms so no eager block short-circuits; sx/sy only have to be finite. sinh/cosh/back are what
// frontVis and every backface test read, and holding them at 0/1/0 is what makes the ±dy trick below
// flip frontVis deterministically.
const SHAPE_STUB_CAM = { sinh: 0, cosh: 1, back: 0, EH: 1, FL: 400, R: 24, proj: (x, y, z) => ({ sx: x * 100, sy: -z * 100, f: 4 }) };

// One raw pass. `dyOff` positions the model so that frontVis (which is just `dy + fh < 0` under this
// stub cam) comes out the way we want: negative → the entrance face is toward the camera.
function captureRawPass(m, fh, h, seed, dyOff) {
  const savedFace = FACE_SINK, savedFog = FOG_STATE, savedLight = LIGHT_STATE, savedSign = _bladeSign;
  const sink = [];
  try {
    // A scratch face sink is REQUIRED, not tidiness: emitFace runs its closure immediately when
    // FACE_SINK is null, so capturing from outside a world pass (which is what collision does) would
    // otherwise execute every deferred paint closure in the arm against the stub ctx.
    FACE_SINK = [];
    FOG_STATE = null; LIGHT_STATE = null;
    SHAPE_SINK = sink;
    drawTypeModel(SHAPE_STUB_CTX, SHAPE_STUB_CAM, 0, dyOff, fh, h, m, seed, 0, 1, 0, [0, 1], '');
  } finally {
    // Restore in a finally so a throwing arm can't leave the sink installed and blank the skyline.
    SHAPE_SINK = null; FACE_SINK = savedFace; FOG_STATE = savedFog; LIGHT_STATE = savedLight; _bladeSign = savedSign;
  }
  return sink;
}

// The numeric (geometric) fields of each record kind. Everything else — yaw, palette, facet counts,
// booleans — is scale-invariant and copied through.
const SHAPE_NUM_FIELDS = {
  box:      ['dx', 'dy', 'hwRaw', 'wz0', 'wz1'],
  drum:     ['dx', 'dy', 'wz0', 'wz1', 'rb', 'rt'],
  barrel:   ['dx', 'dy', 'cxL', 'hl', 'hw', 'wz0', 'archH'],
  sawtooth: ['dx', 'dy', 'hx', 'hy', 'wz0', 'rh'],
};

// Every geometric scalar is stored DECOMPOSED as [a, b, c], meaning `a·fh + b·h + c`.
//
// The obvious schema — widths are multiples of fh, heights multiples of h — is WRONG, and the
// linearity check caught it: nine models derive a vertical from the footprint instead. A barrel
// roof's rise is a function of how wide the shed is (diner, warehouse, hangar, buzzard, bonded,
// studio), and the Layover's drum sits on fh-derived z. Those arms aren't buggy — a roof arch really
// is proportional to its span — the single-basis assumption was.
//
// So instead of assuming a basis, we SOLVE for it. Three captures give three equations:
//   v(1,1) = a + b + c    v(2,1) = 2a + b + c    v(1,2) = a + 2b + c
//   ⇒ a = v(2,1) − v(1,1)   b = v(1,2) − v(1,1)   c = v(1,1) − a − b
// exact for anything affine in fh and h, whichever basis an arm happened to reach for, and yielding
// zeros for the common single-basis case. A fourth capture at (2,3) then verifies it.
//
// The CONSTANT term c exists because one arm genuinely needs it: the Layover's water-tank cap is a
// cone, and its apex radius is the literal 0.001 rather than a fraction of anything. Supporting c
// keeps that arm untouched — which is the whole premise — but a constant is also exactly what a
// modelling mistake looks like, so the bake WARNS on any that isn't negligible instead of hiding it.
const SHAPE_SOLVE_SCALES = [[1, 1], [2, 1], [1, 2]];
const SHAPE_VERIFY_SCALE = [2, 3];
const SHAPE_CONST_WARN = 1e-3;   // |c| above this is worth a human look
// Evaluate a decomposed scalar at a live footprint/height. The one function every consumer uses.
export const shapeVal = (p, fh, h) => p[0] * fh + p[1] * h + p[2];

// Solve one model's segment list into decomposed form. `raws` are the three raw passes, in
// SHAPE_SOLVE_SCALES order, all taken at the same dyOff. Returns null with a reason if the passes
// don't align or the result isn't linear.
function solveSegs(raws, dyOff) {
  const [r11, r21, r12] = raws;
  if (r21.length !== r11.length || r12.length !== r11.length) return { err: `segment count varies with scale (${r11.length}/${r21.length}/${r12.length})` };
  const out = [];
  for (let i = 0; i < r11.length; i++) {
    const s11 = r11[i], s21 = r21[i], s12 = r12[i];
    if (s11.kind !== s21.kind || s11.kind !== s12.kind) return { err: `segment ${i} changes kind with scale` };
    const fields = SHAPE_NUM_FIELDS[s11.kind];
    if (!fields) return { err: `segment ${i} has unknown kind ${s11.kind}` };
    const seg = { kind: s11.kind };
    for (const f of fields) {
      // dy carries the frontVis staging offset, which is absolute and must come out before solving.
      const off = f === 'dy' ? dyOff : 0;
      const v11 = s11[f] - off, v21 = s21[f] - off, v12 = s12[f] - off;
      const a = v21 - v11, b = v12 - v11, c = v11 - a - b;
      seg[f] = [a, b, c];
    }
    // Scale-invariant passengers.
    seg.pal = s11.pal;
    if (s11.kind === 'box') { seg.yaw = s11.yaw; seg.roof = s11.roof; if (s21.yaw !== s11.yaw) return { err: `segment ${i} yaw varies with scale` }; }
    if (s11.kind === 'drum') { seg.n = s11.n; seg.cap = s11.cap; }
    if (s11.kind === 'barrel') { seg.nf = s11.nf; seg.base = s11.base; }
    if (s11.kind === 'sawtooth') { seg.teeth = s11.teeth; seg.roofc = s11.roofc; seg.glassc = s11.glassc; seg.edge = s11.edge; }
    // Convenience: the segment's vertical span, so no consumer has to know that a barrel's top is
    // wz0+archH while a box's is wz1.
    const add = (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
    seg.z0 = seg.wz0;
    seg.z1 = seg.kind === 'barrel' ? add(seg.wz0, seg.archH)
      : seg.kind === 'sawtooth' ? add(seg.wz0, seg.rh)
        : seg.wz1;
    seg.cx = seg.dx; seg.cy = seg.dy;
    out.push(seg);
  }
  return { segs: out };
}

// Structural identity of a segment, rounded, for the multiset diff below. Excludes `frontOnly`
// (which is what we're computing) and `pal` (texture, not geometry).
function segKey(s) {
  const r = (v) => (Array.isArray(v) ? v.map(n => Math.round(n * 1e6) / 1e6) : v);
  return JSON.stringify([s.kind, r(s.cx), r(s.cy), r(s.z0), r(s.z1), r(s.hwRaw), s.yaw, r(s.rb), r(s.rt), s.n, r(s.cxL), r(s.hl), r(s.hw), r(s.hx), r(s.hy), s.teeth]);
}

// Capture one model, decomposed, with entrance-face mass tagged.
//
// TWO SIDES. Six arms gate mass on `frontVis` — the roller doors and truck bays on studio,
// warehouse, container_yard, cold_storage, garage and freight_forwarder. Capturing once would
// either always include them or always drop them; instead we capture with the door face toward the
// camera and away from it, and multiset-diff. What only the near side produced is a door, and gets
// `frontOnly: true` so a consumer can decide (shadows want it, a wireframe may not).
function captureAt(m, seed) {
  const side = (dyOff) => solveSegs(SHAPE_SOLVE_SCALES.map(([fh, h]) => captureRawPass(m, fh, h, seed, dyOff)), dyOff);
  const near = side(-8); if (near.err) throw new Error(near.err);
  const far = side(+8); if (far.err) throw new Error(far.err);
  const farCount = new Map();
  for (const s of far.segs) { const k = segKey(s); farCount.set(k, (farCount.get(k) || 0) + 1); }
  for (const s of near.segs) {
    const k = segKey(s), n = farCount.get(k) || 0;
    if (n > 0) farCount.set(k, n - 1); else s.frontOnly = true;
  }
  return near.segs;
}

// The bake's correctness gate, and worth more than any amount of staring at towers: re-derive the
// model at a scale the decomposition never saw and demand it match exactly. Catches an arm putting
// an absolute constant into a mass argument — a z-fight epsilon, a hardcoded ledge — at bake time
// rather than as a mystery few-centimetre offset in the sim a month later.
function shapeLinearityError(m, seed) {
  let segs;
  try { segs = captureAt(m, seed); } catch (e) { return e.message; }
  const [fh, h] = SHAPE_VERIFY_SCALE;
  const raw = captureRawPass(m, fh, h, seed, -8);
  if (raw.length !== segs.length) return `segment count differs at the verify scale (${segs.length} vs ${raw.length})`;
  for (let i = 0; i < segs.length; i++) {
    for (const f of SHAPE_NUM_FIELDS[segs[i].kind]) {
      const off = f === 'dy' ? -8 : 0;
      if (Math.abs(shapeVal(segs[i][f], fh, h) - (raw[i][f] - off)) > 1e-9) return `segment ${i} (${segs[i].kind}).${f} is not affine in fh/h`;
    }
  }
  return null;
}
// Non-negligible absolute terms, as `segment.field = c` strings. Not an error — see the constant-term
// note above — but a constant is what a modelling slip looks like, so the bake prints these.
export function shapeConstantWarnings(m, seed = 0) {
  const out = [];
  let segs; try { segs = captureAt(m, seed); } catch { return out; }
  segs.forEach((s, i) => {
    for (const f of SHAPE_NUM_FIELDS[s.kind]) if (Math.abs(s[f][2]) > SHAPE_CONST_WARN) out.push(`seg ${i} (${s.kind}).${f} carries an absolute ${s[f][2].toFixed(4)}`);
  });
  return out;
}
// SEED VARIANCE. Shape is a pure function of the model for most arms, but roofClutter's penthouse
// height is frac(seed) and its water tank only exists on seed%4===0, and junkshop's roof junk varies
// outright. Those models must be keyed by seed at runtime instead of cached once.
function shapeIsSeedVariant(m) {
  const probes = [1, 2, 3, 4];   // 4 probes because roofClutter's water tank is seed%4===0
  const first = captureAt(m, probes[0]).map(segKey).join('|');
  return probes.slice(1).some(s => captureAt(m, s).map(segKey).join('|') !== first);
}

// ── Runtime cache ────────────────────────────────────────────────────────────
// Keyed on the MODEL RECORD OBJECT, not on m.type: NAMED_MODELS/TYPE_MODEL entries are distinct
// literals created once at module load, so object identity separates models that share a type but
// differ in geometry via m.penthouse (the Meridian's extra roof box) or m.big (the wide hangar).
const _shapeCache = new WeakMap();
let _shapeFailed = false;
// The captured mass of one building model, normalized. Returns null (and logs once) if an arm
// throws under the stub, so a bad model degrades to today's plain box instead of killing the sim.
export function shapeForModel(m, seed) {
  if (!m) return null;
  let e = _shapeCache.get(m);
  if (!e) { e = { variant: null, base: null, bySeed: new Map() }; _shapeCache.set(m, e); }
  try {
    if (e.variant === null) e.variant = shapeIsSeedVariant(m);
    if (!e.variant) return (e.base ||= captureAt(m, 0));
    const k = seed | 0;
    let s = e.bySeed.get(k);
    if (!s) { s = captureAt(m, k); e.bySeed.set(k, s); }
    return s;
  } catch (err) {
    if (!_shapeFailed) { _shapeFailed = true; console.error('[windshield] shape capture failed:', err); }
    return null;
  }
}

// ── Occlusion culling ────────────────────────────────────────────────────────
// There is no z-buffer here — the face queue is a painter's algorithm — so a building standing
// completely behind a nearer tower is still fully built, queued, depth-sorted and filled. Downtown
// that is a large fraction of ~2870 faces a frame spent on pixels nobody ever sees. Unlike the
// distance LOD this has no visual tradeoff to argue about: it only ever removes buildings that are
// already invisible.
//
// The structure is a 1-D horizontal span buffer. Every building is anchored to the ground, so a
// nearer one covers a contiguous screen band from its roofline DOWN. `covTop[col]` therefore holds
// the topmost screen y that is solidly covered from there downward, and a farther building is
// hidden when its whole silhouette sits below that line across its entire width.
//
// CONSERVATISM IS THE WHOLE GAME — culling something visible is a hole in the world, far worse than
// the frames it saves. So the two boxes are deliberately biased apart:
//   • as an OCCLUDER a building contributes only its CORE segment (one solid box, never the setback
//     silhouette whose bounding box claims coverage it doesn't have), shrunk by a margin;
//   • as an OCCLUDEE it is tested with its FULL footprint and roof, expanded by a margin, so a neon
//     blade or a marquee poking out of the mass can't be culled with it.
// A building still fading in is never an occluder, because it isn't opaque yet.
const OCC_BUCKETS = 96;      // horizontal resolution of the span buffer
const OCC_SHRINK = 0.14;     // occluder box inset (fraction of its own size)
const OCC_GROW = 0.22;       // occludee box outset — covers adornments that overhang the mass
const OCC_OPAQUE = 0.98;     // below this alpha a building is still fading in and can't occlude

// Screen-space AABB of a ground-anchored box, or null if any corner is too close/behind the eye.
function screenBox(cam, corners, z0, z1) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [wx, wy] of corners) {
    for (const z of [z0, z1]) {
      const p = cam.proj(wx, wy, z);
      if (p.f <= 0.25) return null;   // near the eye the projection stretches; don't reason about it
      if (p.sx < x0) x0 = p.sx; if (p.sx > x1) x1 = p.sx;
      if (p.sy < y0) y0 = p.sy; if (p.sy > y1) y1 = p.sy;
    }
  }
  return { x0, x1, y0, y1 };
}

// ── Distance LOD ─────────────────────────────────────────────────────────────
// Beyond `lodNear` tiles a building stops running its ~80-line arm and is drawn straight from its
// captured segments instead. Profiling put ~54% of the frame in the building face flush at ~2870
// faces per frame across ~65 buildings — about 45 faces each, whether the building filled the
// screen or four pixels of it. The arm's own execution was only ~11%, so the win here is the faces
// LOD never QUEUES, not the code it skips.
//
// WHY THIS DOESN'T POP. The segments ARE the arm's mass — same primitives, same palettes, same
// numbers — so at the handover distance the LOD draws a byte-identical building. Detail then
// dissolves gradually as you get further away: segments are ranked by visual mass and each one
// fades out individually over its own little band, so you never see a building change shape in one
// frame. The largest segment never fades, which is what stops you seeing through a tower.
//
// WHAT IS LOST, honestly: adornments. Neon blades, marquees, glow pools and beacons live in the arm
// and are gone past `lodNear`. On a night skyline that IS visible, so the default sits well out in
// the fog and it's a slider — push `lodNear` out until you can't see the handover.
const LOD_MIN_ALPHA = 0.02;   // below this a segment is invisible; skip the draw entirely
// Facets on a drum, thinned with distance. MUST return exactly `n` at detail 1 — a fixed cap here
// (the first cut capped at 8) silently made the handover distance a visible facet-count jump on
// every cylinder in the game, which is precisely the pop this design promises not to have.
const lodFacets = (n, detail) => Math.max(5, Math.min(n, Math.round(n * (0.4 + 0.6 * clamp(detail, 0, 1)))));

// Visual mass of a segment at unit scale — footprint area × height. Used only to rank which detail
// survives longest at distance, so a crude measure is the right measure.
function segBulk(s) {
  const V = (p) => Math.abs(p[0]) + Math.abs(p[1]) + Math.abs(p[2]);   // scale-agnostic magnitude
  const hgt = Math.max(0.001, V(s.z1) - V(s.z0));
  const w = s.kind === 'box' ? V(s.hwRaw) : s.kind === 'drum' ? Math.max(V(s.rb), V(s.rt))
    : s.kind === 'barrel' ? (V(s.hl) + V(s.hw)) / 2 : (V(s.hx) + V(s.hy)) / 2;
  return w * w * hgt;
}
// Segments in draw order, each tagged with the detail level at which it starts to appear. Cached on
// the segment array itself so ranking happens once per model, not once per building per frame.
function lodOrder(segs) {
  if (segs._lod) return segs._lod;
  // Rank by bulk — but a REPEATED RUN of small pieces is an architectural feature, not several
  // trivial boxes, and ranking them individually drops the very thing that identifies a building.
  // The Hall of Records is a stone box without its six-column portico; the same mistake would strip
  // the clone facility's vat row, the saloon's porch posts and the container yard's stacks. So
  // segments that repeat (same kind, near-identical dimensions, three or more of them) are ranked
  // on the bulk of the WHOLE GROUP, which keeps a colonnade alive as long as the mass it fronts.
  const sig = (s) => {
    const q = (p) => (p ? Math.round((Math.abs(p[0]) + Math.abs(p[1]) + Math.abs(p[2])) * 200) : 0);
    return `${s.kind}|${q(s.hwRaw)}|${q(s.rb)}|${q(s.hl)}|${q(s.z1)}`;
  };
  const groupBulk = new Map(), groupCount = new Map();
  for (const s of segs) {
    const k = sig(s);
    groupBulk.set(k, (groupBulk.get(k) || 0) + segBulk(s));
    groupCount.set(k, (groupCount.get(k) || 0) + 1);
  }
  const ranked = segs.map((s, i) => {
    const k = sig(s);
    const bulk = groupCount.get(k) >= 3 ? groupBulk.get(k) : segBulk(s);
    return { s, i, bulk };
  }).sort((a, b) => b.bulk - a.bulk);
  const n = ranked.length;
  ranked.forEach((r, rank) => { r.at = n <= 1 ? 0 : rank / n; });   // rank 0 (the core) is always drawn
  // A repeated group also has to be ATOMIC. Ranking alone still gave them consecutive thresholds, so
  // a portico lost its columns one at a time — and two of six columns reads as a broken building,
  // which is worse than the simplification it was meant to be. Every member of a group takes the
  // group's earliest threshold, so a colonnade arrives and leaves all at once.
  const first = new Map();
  for (const r of ranked) {
    const k = sig(r.s);
    if (groupCount.get(k) >= 3) first.set(k, Math.min(first.has(k) ? first.get(k) : 1, r.at));
  }
  for (const r of ranked) { const k = sig(r.s); if (first.has(k)) r.at = first.get(k); }
  // Restore original source order for painting — the depth queue sorts anyway, but keeping source
  // order means ties resolve exactly as the arm resolved them.
  const byIndex = ranked.slice().sort((a, b) => a.i - b.i);
  segs._lod = { byIndex, band: n <= 1 ? 1 : 1 / n };
  return segs._lod;
}

// Draw a building from its captured segments. `detail` 0..1: 1 = every segment (identical mass to
// the arm), 0 = the single largest. Returns false if the model has no capture, so the caller can
// fall back to the real arm rather than drawing nothing.
function drawModelLOD(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, E, detail) {
  const segs = shapeForModel(m, seed);
  if (!segs || !segs.length) return false;
  const { byIndex, band } = lodOrder(segs);
  // Model-local → world. The yaw term is the trap: rotating a segment's CENTRE without also turning
  // its FOOTPRINT leaves the three twisted towers (Halcyon, Solenne, the Ascendant spire) sitting in
  // the right place with the wrong orientation — subtle enough to ship unnoticed.
  const th = Math.atan2(-E[0], E[1]), ct = Math.cos(th), st = Math.sin(th);
  const V = (p) => p[0] * fh + p[1] * h + p[2];
  for (const r of byIndex) {
    const s = r.s;
    const fade = r.at <= 0 ? 1 : clamp((detail - r.at) / band, 0, 1);
    if (fade <= LOD_MIN_ALPHA) continue;
    const a = alpha * fade;
    const lx = V(s.cx), ly = V(s.cy);
    const wx = dx + lx * ct - ly * st, wy = dy + lx * st + ly * ct;
    const z0 = V(s.z0), z1 = V(s.z1);
    if (s.kind === 'box') {
      draw3DBoxAt(ctx, cam, wx, wy, V(s.hwRaw), z0, z1, s.pal, seed + r.i, night, a, s.roof, s.yaw + th);
    } else if (s.kind === 'drum') {
      const base = WALL_COL[s.pal] || [96, 104, 116];
      const skin = (fc) => { const k = 0.5 + fc.nl * 0.55; return `rgba(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0},0.97)`; };
      const capCol = s.cap ? `rgba(${base[0] * 0.8 | 0},${base[1] * 0.8 | 0},${base[2] * 0.8 | 0},0.97)` : null;
      drawFacetDrum(ctx, cam, wx, wy, z0, z1, V(s.rb), V(s.rt), lodFacets(s.n, detail), a, skin, capCol);
    } else if (s.kind === 'barrel') {
      // A barrel roof takes its LOCAL FRAME as a closure, not world coords — and that frame is
      // reconstructible here, because the capture stored the anchor and we know E. So a distant
      // shed roof is the REAL half-cylinder, not a box pretending to be one. Only when the detail
      // budget runs out does it collapse, and then to a rectangular slab of the same span rather
      // than a square (a hangar is long, and a square roof on a long shed reads instantly wrong).
      if (detail > 0.45) {
        const FL = (lx, ly) => facePt(wx, wy, lx, ly, E);
        drawBarrelRoof(ctx, cam, FL, V(s.cxL), V(s.hl), V(s.hw), z0, V(s.archH), Math.max(4, Math.round(s.nf * (0.4 + 0.6 * detail))), a, s.base || (WALL_COL[s.pal] || [90, 96, 104]));
      } else {
        const cxL = V(s.cxL), bx = wx + cxL * ct, by = wy + cxL * st;
        drawSlabAt(ctx, cam, bx, by, V(s.hl), V(s.hw), z0, z0 + (z1 - z0) * 0.66, s.pal, seed + r.i, night, a, th);
      }
    } else {
      // Sawtooth: the real monitor roof while there's detail to spend, else a slab of the deck.
      if (detail > 0.45) {
        sawtoothRoof(ctx, cam, wx, wy, E, V(s.hx), V(s.hy), z0, V(s.rh), s.teeth, s.roofc, s.glassc, s.edge, a);
      } else {
        drawSlabAt(ctx, cam, wx, wy, V(s.hx), V(s.hy), z0, z0 + (z1 - z0) * 0.66, s.pal, seed + r.i, night, a, th);
      }
    }
  }
  if (PERF.on) PERF.n.lod++;
  return true;
}

// ── Shape wireframe overlay (dev) ────────────────────────────────────────────
// Strokes the captured segments over the live render so you can SEE whether the geometry the
// collision sweep, the ground shadow and the cold open are all reading actually sits on the
// building. Every bug this system can have is a bug you can see here in one glance: a lost `yaw`
// leaves a twisted tower's cage square, a missed `frontOnly` puts a roller door in mid-air, a bad
// rotation slides the whole cage off the model.
//
// Colour carries meaning: cyan = ordinary mass, amber = entrance-face mass (frontOnly), magenta =
// the segment that survives to the furthest LOD level (the one that must never fade).
// RENDER_TUNE.shapeWire = 0 off / 1 on. Drawn after the face flush, so it sits on top of everything.
function drawShapeWire(ctx, cam, dx, dy, fh, h, m, seed, E, coreIdx) {
  const segs = shapeForModel(m, seed); if (!segs || !segs.length) return;
  const th = Math.atan2(-E[0], E[1]), ct = Math.cos(th), st = Math.sin(th);
  const V = (p) => p[0] * fh + p[1] * h + p[2];
  ctx.save();
  ctx.lineWidth = 1;
  segs.forEach((s, i) => {
    const lx = V(s.cx), ly = V(s.cy);
    const wx = dx + lx * ct - ly * st, wy = dy + lx * st + ly * ct;
    const z0 = V(s.z0), z1 = V(s.z1);
    // Half-extents along local x/y, then turned into world by the segment's own yaw plus the
    // model's entrance rotation — the same composition the LOD renderer does.
    let hx, hy, yaw = th;
    if (s.kind === 'box') { hx = hy = Math.min(V(s.hwRaw), 0.44); yaw = s.yaw + th; }
    else if (s.kind === 'drum') { hx = hy = Math.max(V(s.rb), V(s.rt)); }
    else if (s.kind === 'barrel') { hx = V(s.hl); hy = V(s.hw); }
    else { hx = V(s.hx); hy = V(s.hy); }
    const cy2 = Math.cos(yaw), sy2 = Math.sin(yaw);
    const corner = (sx, sy) => {
      const ax = sx * hx, ay = sy * hy;
      return [wx + ax * cy2 - ay * sy2, wy + ax * sy2 + ay * cy2];
    };
    const cs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    const lo = cs.map(([x, y]) => cam.proj(x, y, z0)), hi = cs.map(([x, y]) => cam.proj(x, y, z1));
    if (lo.some(p => p.f <= 0.1) || hi.some(p => p.f <= 0.1)) return;
    ctx.strokeStyle = i === coreIdx ? 'rgba(255,90,220,.95)' : s.frontOnly ? 'rgba(255,180,60,.9)' : 'rgba(80,240,255,.75)';
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const n = (k + 1) % 4;
      ctx.moveTo(lo[k].sx, lo[k].sy); ctx.lineTo(lo[n].sx, lo[n].sy);   // base ring
      ctx.moveTo(hi[k].sx, hi[k].sy); ctx.lineTo(hi[n].sx, hi[n].sy);   // top ring
      ctx.moveTo(lo[k].sx, lo[k].sy); ctx.lineTo(hi[k].sx, hi[k].sy);   // corner post
    }
    ctx.stroke();
  });
  ctx.restore();
}

// A rectangular extruded slab — the LOD stand-in for the two non-square mass kinds. Half-extents are
// along the model's local x (span) and y (sweep), turned by `yaw` into world.
function drawSlabAt(ctx, cam, dx, dy, halfX, halfY, z0, z1, pal, seed, night, alpha, yaw) {
  draw3DBoxAt(ctx, cam, dx, dy, halfX, z0, z1, pal, seed, night, alpha, true, yaw, halfY);
}

// Faces a model's ADORNMENTS alone would queue — the cost of keeping a LOD building lit. Counted by
// running the real adornments-only pass, not estimated, because the answer decides whether the
// near-lossless LOD is affordable. Diagnostic; used by shapes:smoke.
export function shapeAdornCost(m, tier = ADORN_RICH, night = 0.9, camF = 4) {
  const savedFace = FACE_SINK, savedFog = FOG_STATE, savedLight = LIGHT_STATE, savedSign = _bladeSign;
  SHAPE_STUB_COST.grads = 0; SHAPE_STUB_COST.blurs = 0;
  // `camF` stands in for camera distance, which is what decides whether a neon sign earns its blur.
  const cam = camF === 4 ? SHAPE_STUB_CAM : { ...SHAPE_STUB_CAM, proj: (x, y, z) => ({ sx: x * 100, sy: -z * 100, f: camF }) };
  try {
    FACE_SINK = []; MASS_OFF = true; ADORN_TIER = tier;
    drawTypeModel(SHAPE_STUB_CTX, cam, 0, -8, 0.4, 1, m, 3, night, 1, 1000, [0, 1], 'SIGN');
    // The closures are where the gradients and blurs live, so they have to actually run.
    flushFaces();
    return { faces: 0, grads: SHAPE_STUB_COST.grads, blurs: SHAPE_STUB_COST.blurs };
  } catch { return { faces: 0, grads: 0, blurs: 0 }; } finally {
    MASS_OFF = false; ADORN_TIER = ADORN_RICH; FACE_SINK = savedFace; FOG_STATE = savedFog; LIGHT_STATE = savedLight; _bladeSign = savedSign;
  }
}

// A model reduced to a uniform list of WIREFRAME BOXES, ordered most-important first, for consumers
// that want a silhouette rather than a render — the cold open above all, which strokes cages and has
// no use for the difference between a drum and a box.
//
// Every kind collapses to {cx, cy, hx, hy, z0, z1, yaw}: a drum becomes a box of its radius, a
// barrel roof a slab of its span, a sawtooth deck a slab of its deck. Values stay in the affine
// [a·fh + b·h + c] form so the consumer can pick its own scale — the cold open's storeys are much
// taller than the sim's, and this is what lets one bake serve both.
//
// Ordering is the LOD ranking, so `max` gives you the N most defining pieces of a building, with
// repeated groups (a colonnade) already kept together.
export function shapeWireList(m, max = 6) {
  const segs = shapeForModel(m, 0);
  if (!segs || !segs.length) return [];
  const { byIndex } = lodOrder(segs);
  const ranked = byIndex.slice().sort((a, b) => a.at - b.at || a.i - b.i);
  // ALWAYS keep the tallest piece, whatever its bulk. The LOD ranking is by visual mass, which is
  // right for a solid renderer — a spire covers almost no pixels — but wrong for a SILHOUETTE, and
  // wrong for anything that needs to know how tall a building really is. Trimming by bulk alone
  // dropped Halcyon's crown and reported the tower as 1.0× its storey stack instead of 2.9×, which
  // would have flown the cold open's camera straight through it.
  const topZ = (r) => shapeVal(r.s.z1, 1, 1);
  let tallest = ranked[0];
  for (const r of ranked) if (topZ(r) > topZ(tallest)) tallest = r;
  const kept = ranked.slice(0, max);
  if (!kept.includes(tallest)) kept[Math.max(0, max - 1)] = tallest;
  // Left in RANK order, not source order: a consumer that can only afford the first two segments
  // should get the two that define the building. Painter order doesn't matter to a wireframe.
  const add = (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
  return kept.map(({ s }) => {
    let cx = s.cx, hx, hy;
    if (s.kind === 'box') { hx = hy = s.hwRaw; }
    else if (s.kind === 'drum') { hx = hy = (Math.abs(s.rb[0]) + Math.abs(s.rb[1]) >= Math.abs(s.rt[0]) + Math.abs(s.rt[1])) ? s.rb : s.rt; }
    else if (s.kind === 'barrel') { cx = add(s.cx, s.cxL); hx = s.hl; hy = s.hw; }
    else { hx = s.hx; hy = s.hy; }
    return { cx, cy: s.cy, hx, hy, z0: s.z0, z1: s.z1, yaw: s.yaw || 0, front: s.frontOnly ? 1 : 0, tall: s === tallest.s ? 1 : 0 };
  });
}

// Faces a model would queue at a given detail level — the number LOD exists to cut. Diagnostic, used
// by shapes:smoke to report the actual saving rather than assert one.
export function shapeLodFaces(m, detail) {
  const segs = shapeForModel(m, 0);
  if (!segs || !segs.length) return 0;
  const { byIndex, band } = lodOrder(segs);
  let n = 0;
  for (const r of byIndex) {
    const fade = r.at <= 0 ? 1 : clamp((detail - r.at) / band, 0, 1);
    if (fade <= LOD_MIN_ALPHA) continue;
    const s = r.s;
    n += s.kind === 'box' ? 4 + (s.roof ? 1 : 0)
      : s.kind === 'drum' ? lodFacets(s.n, detail) + (s.cap ? 1 : 0)
        : 5;   // barrel/sawtooth collapse to a capped box at LOD range
  }
  return n;
}

// ── Envelope helpers ─────────────────────────────────────────────────────────
// Tallest point of the model, as a multiple of `h`. A plain one-box model returns 1.0, which is what
// keeps today's collision ceiling unchanged for the simple types.
export function shapeRoofZ(segs, fh, h) {
  let m = 0; for (const s of segs) { const z = shapeVal(s.z1, fh, h); if (z > m) m = z; } return m;
}
// The model's ground footprint as a convex hull in TILE units, at a live footprint/height. Applies
// the 0.44 clamp draw3DBoxAt applies internally — which is exactly why hwRaw is recorded raw.
export function shapeFootprint(segs, fh, h, { includeFrontOnly = true } = {}) {
  // Memoised on the segment array. The occlusion pre-pass asks for this once per building per frame
  // and a convex hull is not free, so without a cache the culling optimisation pays for itself in
  // hull-building. Keyed on the scale because the 0.44 clamp makes the result non-linear in fh, so
  // one normalised hull can't just be scaled; in practice only a handful of (fh,h) pairs exist.
  const ck = `${fh.toFixed(4)}|${h.toFixed(4)}|${includeFrontOnly ? 1 : 0}`;
  if (!segs._fp) segs._fp = new Map();
  const hit = segs._fp.get(ck);
  if (hit) return hit;
  const V = (p) => shapeVal(p, fh, h);
  const pts = [];
  for (const s of segs) {
    if (s.frontOnly && !includeFrontOnly) continue;
    const cx = V(s.cx), cy = V(s.cy);
    if (s.kind === 'box') {
      const w = Math.min(V(s.hwRaw), 0.44), c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
      for (const [a, b] of [[-w, -w], [w, -w], [w, w], [-w, w]]) pts.push([cx + a * c - b * sn, cy + a * sn + b * c]);
    } else if (s.kind === 'drum') {
      const r = Math.max(V(s.rb), V(s.rt));
      for (let i = 0; i < 8; i++) { const a = i / 8 * 6.2832; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    } else if (s.kind === 'barrel') {
      const x0 = cx + V(s.cxL) - V(s.hl), x1 = cx + V(s.cxL) + V(s.hl), y = V(s.hw);
      pts.push([x0, cy - y], [x1, cy - y], [x1, cy + y], [x0, cy + y]);
    } else if (s.kind === 'sawtooth') {
      const x = V(s.hx), y = V(s.hy);
      pts.push([cx - x, cy - y], [cx + x, cy - y], [cx + x, cy + y], [cx - x, cy + y]);
    }
  }
  const hull = pts.length >= 3 ? convexHull2D(pts) : pts;
  segs._fp.set(ck, hull);
  return hull;
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
  // The pixel-identity guarantee, asserted rather than assumed: no paint path may ever leave a
  // shape sink installed. If this fires, a capture leaked (it failed to restore in a finally) and
  // the frame is about to render buildings as nothing at all.
  if (SHAPE_SINK) { SHAPE_SINK = null; console.error('[windshield] SHAPE_SINK leaked into a render pass — capture did not restore'); }
  pBegin('world:build');
  const map = v.map; if (!map || !map.length) { pEnd(); return; } const R = cam.R, night = sky.night;
  const FAR = VISIBLE_FAR_F, wcx = v.mapCenter ? v.mapCenter.x : 0, wcy = v.mapCenter ? v.mapCenter.y : 0;
  const items = [], wildF = v._wildFill;
  for (let ry = 0; ry < map.length; ry++) for (let rx = 0; rx < map[ry].length; rx++) {
    const c = map[ry][rx]; if (!c) continue;
    // Empty gap between regions: the Mode-7 floor (fillOffMap) already paints it wildlands or sea. Scatter the
    // matching desert dressing over the LAND fill so a long leg reads as real badlands, not bare tint; sea fill
    // (waves carry it) and our own tile stay clear. Real tiles keep their original skip rules below.
    let wild = null;
    if (c.kind === 'air') {
      wild = wildF && wildF[ry] ? wildF[ry][rx] : null;
      if (!wild || wild === 'sea' || c.self) continue;
    } else if ((c.self && c.mark !== 'yacht') || ((c.kind === 'field' || c.biome === 'water') && c.mark !== 'yacht' && !c.bt)) {
      continue;   // the Echelon is a field-on-water tile that DOES get a 3D model — drawn even on our OWN tile so the pilot sits on the helipad, not open water
                  // …and a ROOFTOP pad is a field tile carrying a real building (`bt`): draw the tower, the pad is on top of it
    }
    const dx = (rx - R) - cam.ox, dy = (ry - R) - cam.oy, f = dx * cam.sinh - dy * cam.cosh;
    // Near-clip against the CAMERA, not the craft: in the external chase view the camera sits
    // `back` tiles behind the aircraft, so a building that has slipped behind the model is still
    // well in front of the camera (fCam = f + back) and must keep drawing — clipping on the raw
    // craft distance `f` popped it out the instant it passed the tail. Far stays on `f`.
    const fCam = f + (cam.back || 0);
    // The Echelon is the chase SUBJECT (in the Helm view she's dead-centre) — never tile-cull her, or
    // zooming in / orbiting swings her tile across the near plane and pops the whole hull out. Her own
    // per-face near-clip in drawYacht handles anything that crosses the lens gracefully.
    if (c.mark !== 'yacht' && (fCam <= VISIBLE_NEAR_F || f > FAR)) continue;
    // Buildings hold FULL opacity all the way to the camera — NO near-pass fade — so a
    // building directly ahead of (or passing right beside/under) you never dissolves. Only
    // the far edge fades, and only as haze: distant blocks ghost UP out of the horizon rather
    // than pop in. Nothing else can turn a building translucent.
    //
    // The fade is confined to a THIN band at the very draw limit (the last HAZE_BAND tiles),
    // not a wide swathe — otherwise a prominent mid-distance landmark reads as see-through
    // (the sky showing straight through its body) rather than solid. Buildings closer than
    // FAR − HAZE_BAND are fully opaque; only the last couple of tiles ghost in at the horizon.
    //
    // The old climb-out corridor USED to hide buildings dead-ahead-and-low off the runway;
    // it no longer does — you always see them. cockpit.js still keeps the MATCHING collision
    // immunity (climbOutClear) for that departure window, so a weak climber can out-climb the
    // towers it now flies visibly over instead of them vanishing.
    // tiles of soft fade at the far edge. Eased with smoothstep (not a raw linear ramp): the S-curve
    // is flat at both ends, so a building EMERGES from the horizon gently (zero opacity slope at the
    // very edge = no abrupt pop-in/out) yet crosses back to solid FASTER through the inner half than
    // linear would — so mid-distance blocks stay opaque (no see-through) even with the band widened
    // from 3→4. The visible-translucent window is still only ~1 tile; the extra reach is soft shoulders.
    const HAZE_BAND = 5;   // 4→5: a slightly softer shoulder on the emergence fade
    // Per-building STAGGER so a whole block-face doesn't cross the horizon fade in lockstep and pop in
    // as one solid wall (the "buildings appear all at once" look). Jitter each building's fade edge
    // INWARD by up to STAGGER tiles off a stable world-position hash — so neighbours ghost up "part by
    // part" at slightly different distances instead of together. Inward-only (FAR − jit), so nothing
    // needs map data past the FAR cull, and a single building's own translucent window is unchanged
    // (still HAZE_BAND wide) — mid-distance landmarks stay solid, only WHICH tile each fades at shifts.
    const STAGGER = 3;
    const jit = c.mark === 'yacht' ? 0 : frac((Math.round((rx - R) + wcx) + 512) * 1.37 + (Math.round((ry - R) + wcy) + 512) * 2.19) * STAGGER;
    // The Echelon escapes the worldBlend gate: she lives ONLY in this Mode-7 pass (no flat airport
    // scene stands in for her), so she must stay fully drawn even parked on her pad (worldBlend 0) —
    // otherwise she vanishes on the deck and pops in only as you climb through the crossfade. Every
    // other world object still crossfades against the airport scenery as before.
    let alpha = smoothstep((FAR - jit - f) / HAZE_BAND) * (c.mark === 'yacht' ? 1 : (v.worldBlend ?? 1));
    if (alpha <= 0.02) continue;
    // Seed from the WORLD tile (stable), NOT the array index — so a building keeps its shape
    // when the server recenters the map window (was the main "popping in and out" cause).
    const wx = Math.round((rx - R) + wcx), wy = Math.round((ry - R) + wcy);
    items.push({ dx, dy, f, c, alpha, seed: (wx + 512) * 73 + (wy + 512) * 149, wx, wy, rx, ry, wild });   // stable, positive, frac-friendly
  }
  items.sort((a, b) => b.f - a.f);
  // Occlusion pre-pass: walk NEAR→FAR (the reverse of the paint order) building a span buffer, and
  // mark every building already hidden behind a nearer one. See the notes above screenBox — the
  // occluder/occludee boxes are deliberately biased so this can only ever be too timid.
  let occluded = null;
  if (RENDER_TUNE.occlude) {
    const W = (ctx.canvas && ctx.canvas.width) || 1280;
    const covTop = new Float32Array(OCC_BUCKETS).fill(Infinity);
    const col = (x) => clamp(Math.floor(x / W * OCC_BUCKETS), 0, OCC_BUCKETS - 1);
    occluded = new Set();
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (!it.c || !it.c.bt) continue;
      const om = modelFor(it.c); if (!om) continue;
      const segs = shapeForModel(om, it.seed); if (!segs || !segs.length) continue;
      const oh = floorHeight(it.c, it.seed);
      const ofh = (BUILDING_FOOT + frac(it.seed + 2) * 0.06) * RENDER_TUNE.bldgFoot;
      const E = faceVec(it.c.ent), th = Math.atan2(-E[0], E[1]), ct = Math.cos(th), st = Math.sin(th);
      const toWorld = ([lx, ly]) => [it.dx + lx * ct - ly * st, it.dy + lx * st + ly * ct];
      // Occludee: the whole building, grown.
      const hull = shapeFootprint(segs, ofh, oh).map(toWorld);
      const box = hull.length >= 3 ? screenBox(cam, hull, 0, shapeRoofZ(segs, ofh, oh)) : null;
      if (box) {
        const gw = (box.x1 - box.x0) * OCC_GROW, gh = (box.y1 - box.y0) * OCC_GROW;
        const x0 = box.x0 - gw, x1 = box.x1 + gw, yTop = box.y0 - gh;
        let hidden = x1 >= 0 && x0 <= W;
        for (let c = col(x0); hidden && c <= col(x1); c++) if (covTop[c] > yTop) hidden = false;
        if (hidden) { occluded.add(it); if (PERF.on) PERF.n.culled++; continue; }   // hidden things occlude nothing
      }
      // Occluder: the core segment only, shrunk — a guaranteed-solid slab of this building.
      if (it.alpha < OCC_OPAQUE) continue;
      const core = lodOrder(segs).byIndex.find(r => r.at <= 0);
      if (!core) continue;
      const V = (p) => p[0] * ofh + p[1] * oh + p[2];
      const cw = core.s.kind === 'box' ? Math.min(V(core.s.hwRaw), 0.44)
        : core.s.kind === 'drum' ? Math.max(V(core.s.rb), V(core.s.rt)) * 0.7 : V(core.s.hl || core.s.hx) * 0.7;
      const ccx = V(core.s.cx), ccy = V(core.s.cy), k = cw * (1 - OCC_SHRINK);
      const cc = [[ccx - k, ccy - k], [ccx + k, ccy - k], [ccx + k, ccy + k], [ccx - k, ccy + k]].map(toWorld);
      const cbox = screenBox(cam, cc, 0, V(core.s.z1) * (1 - OCC_SHRINK));
      if (!cbox) continue;
      for (let c = col(cbox.x0); c <= col(cbox.x1); c++) if (cbox.y0 < covTop[c]) covTop[c] = cbox.y0;
    }
  }
  // Shadow pre-pass: lay every building's ground shadow FIRST (far→near) so the bodies drawn
  // next sit on top of the whole shadow field instead of over-painting a neighbour's shadow.
  if (sun && sun.len > 0) {
    const shadowFar = RENDER_TUNE.shadowFar || Infinity;
    for (const it of items) {
      if (!it.c.bt || it.f > shadowFar) continue;   // a distant building's ground shadow is an invisible smear — skip it
      const h = floorHeight(it.c, it.seed);
      const fh = (BUILDING_FOOT + frac(it.seed + 2) * 0.06) * RENDER_TUNE.bldgFoot;
      const sm = RENDER_TUNE.shapeShadow ? modelFor(it.c) : null;
      drawBuildingShadow(ctx, cam, it.dx, it.dy, fh, h, sun, it.alpha, sm ? shapeForModel(sm, it.seed) : null, sm ? faceVec(it.c.ent) : null);
    }
  }
  // ONE depth-sorted face queue for the WHOLE world pass (not per-building). Every building's
  // faces AND every atomic non-building object (statue, yacht, park/tree/rock billboards, curtain,
  // nofly box) queue into a single sink and paint back→front TOGETHER — so ADJACENT buildings
  // occlude each other correctly instead of each building painting as an atomic unit ordered only
  // by its tile-centre distance (the "see-through / overlapping" bug on dense, tall clusters).
  // Buildings emit their own faces directly (drawTypeModel/drawBuilding → draw3DBoxAt → emitFace);
  // point-like objects are wrapped at their tile-centre depth `od` (in the projected-f frame that
  // matches box faces: proj's f at a tile centre = it.f + back). During the final flush the sink is
  // already null, so a wrapped drawer's own internal emitFace calls paint immediately — keeping each
  // object internally ordered as before, just positioned correctly among the buildings.
  // Decorations (glows, beacons, masts, signs, light-runners, holo ads) carry a REAL lifted depth via
  // decoDepth — they sit on top of their own building but a nearer building correctly occludes them,
  // instead of a distant landmark's crown/glow bleeding through everything in front (see decoDepth).
  // Arm the shared N64 fog for the building pass (same colour/band as the Mode-7 floor, so ground and
  // skyline dissolve into one wall). draw3DBoxAt reads FOG_STATE per face; cleared after the flush.
  const fogAmt = RENDER_TUNE.fog || 0, fnm = 1 - night * 0.42;
  const fogCol = [sky.hor[0] * fnm, sky.hor[1] * fnm, sky.hor[2] * fnm];
  FOG_STATE = fogAmt > 0.001 ? { amt: fogAmt, col: fogCol, css: `rgb(${fogCol[0] | 0},${fogCol[1] | 0},${fogCol[2] | 0})` } : null;
  // Arm the cyberpunk Gouraud vertex light (draw3DBoxAt reads LIGHT_STATE per wall). Key = the sun when
  // it's up, else a fixed NW fill so night towers still model. Palette lerps day→toxic-neon by night.
  const lStr = RENDER_TUNE.vlight ?? 1;
  const keyUp = sun && sun.elev > 0.05;
  LIGHT_STATE = lStr > 0.001 ? {
    sx: keyUp ? sun.dir[0] : -0.707, sy: keyUp ? sun.dir[1] : -0.707, str: lStr,
    sky: mix(hexRgb(RENDER_TUNE.vlSkyDay), hexRgb(RENDER_TUNE.vlSkyNight), night),
    key: mix(hexRgb(RENDER_TUNE.vlKeyDay), hexRgb(RENDER_TUNE.vlKeyNight), night),
    shadow: mix(hexRgb(RENDER_TUNE.vlShadowDay), hexRgb(RENDER_TUNE.vlShadowNight), night),
  } : null;
  beginFaces();
  for (const it of items) {
    // Fully hidden behind a nearer building (see the occlusion pre-pass). Skipped before anything is
    // built or queued — the point is to not pay for it at all, not to pay and then not show it.
    if (occluded && occluded.has(it)) continue;
    const alpha = it.alpha, bi = it.c.biome, od = it.f + (cam.back || 0);
    if (it.c.mark === 'statue') { emitFace(od, () => drawStatue(ctx, cam, it.dx, it.dy, BUILDING_FOOT * RENDER_TUNE.bldgFoot, it.seed, night, alpha, now)); continue; }   // town-square monument + fountain
    if (it.c.mark === 'gate') { emitFace(od, () => drawSouthGate(ctx, cam, it.dx, it.dy, BUILDING_FOOT * RENDER_TUNE.bldgFoot, it.c.cur || 'ew', it.seed, night, alpha, now)); continue; }   // the Curtain's fortified breach — flanking pylons + arch energy field + turrets
    if (it.c.mark === 'yacht') {
      // Normally she's drawn on her own tile (with a sub-tile glide while under way). While we're
      // PARKED on her deck (our own tile AND on the ground) we pin her AFT HELIPAD (yacht-local
      // 0,0.28, shrunk with the hull by YACHT_SCALE) under own-ship (the camera origin) instead of
      // her hull centre — so the pilot sits ON the pad, not on the foredeck or in open water beside
      // her. But the moment we LIFT OFF we drop the pin and draw her at her true world tile: pinned,
      // she stayed glued under the climbing heli like a duplicate copy sliding along until we crossed
      // to the next tile; unpinned, she just recedes into the Mode-7 world as we climb away.
      const hr = (it.c.heading || 0) * Math.PI / 180, sub = it.c.sub, padOY = 0.28 * YACHT_SCALE;
      const pinPad = it.c.self && v.onGround;
      const yx = pinPad ? Math.sin(hr) * padOY : it.dx + (sub ? sub.x : 0);
      const yy = pinPad ? -Math.cos(hr) * padOY : it.dy + (sub ? sub.y : 0);
      emitFace(od, () => {
        drawYacht(ctx, cam, yx, yy, BUILDING_FOOT * RENDER_TUNE.bldgFoot, it.seed, night, alpha, now, it.c.wake, it.c.heading, sun);
        if (v.padDome) drawYachtPadDome(ctx, cam, yx, yy, hr, now, alpha, v.padDome.armed);
      });
      continue;
    }   // the Echelon — a high-poly superyacht hull, sun-lit (wake/heading present only when she's under way; `sub` glides her sub-tile toward her destination across a passage). padDome = an auto-land guidance dome over her helipad, drawn for a nearby helicopter.
    if (it.c.kind === 'nofly') { emitFace(od, () => draw3DBox(ctx, cam, it.dx, it.dy, 0.3, 0.55, '__nofly', it.seed, night, alpha * 0.7)); continue; }
    if (it.c.cur) { emitFace(od, () => drawCurtainWall(ctx, cam, it.dx, it.dy, it.c.cur, alpha, now)); continue; }   // the Curtain energy wall on a land-edge tile
    if (bi === 'park' && !it.c.bt) { emitFace(od, () => drawParkTile(ctx, cam, it.dx, it.dy, night, it.seed, alpha, now, it.c.pf)); continue; }   // manicured park: authored `park_feature` (symmetry) or a seeded dressing (grove / pond / benches / flowerbeds / path)
    if (bi === 'parkland' && !it.c.bt) { emitFace(od, () => drawTreeBB(ctx, cam, it.dx, it.dy, night, it.seed, alpha)); continue; }
    // Per-tile jitter: nudge a scattered object off its tile centre by a world-stable hash so the
    // wilds don't read as objects lined up on the grid. Two independent hashes (x/y) span ±~0.4 tile,
    // deterministic off the world coord so a given object stays put as the map window recentres.
    const jx = (frac(it.wx * 12.9898 + it.wy * 78.233) - 0.5) * 0.8;
    const jy = (frac(it.wx * 39.346 + it.wy * 11.135) - 0.5) * 0.8;
    // Procedural gap wildlands: scatter over an empty inter-region tile the floor filled as land, keyed to the
    // SAME classification the ground used (scrub near a shore, redrock mesa deeper) so scatter and tint agree.
    if (it.wild && !it.c.bt) { if ((it.seed % (it.wild === 'redrock' ? 2 : 3)) === 0) emitFace(od, () => drawWildScatter(ctx, cam, it.dx + jx, it.dy + jy, it.wild, night, it.seed, alpha)); continue; }
    if (bi === 'badlands' && !it.c.bt) { if ((it.seed % 3) === 0) emitFace(od, () => drawRockBB(ctx, cam, it.dx + jx, it.dy + jy, night, it.seed, alpha)); continue; }
    // Arid wildlands: per-biome scatter (mesa/hoodoo over redrock, cactus/brush over scrub, dead
    // snags/bone over ash) picked by the tile seed. Rust mesa (redrock) is denser than scrub/ash.
    if ((bi === 'scrub' || bi === 'redrock' || bi === 'ash') && !it.c.bt) { if ((it.seed % (bi === 'redrock' ? 2 : 3)) === 0) emitFace(od, () => drawWildScatter(ctx, cam, it.dx + jx, it.dy + jy, bi, night, it.seed, alpha)); continue; }
    // Trees & small forests on OPEN grass (no building, no road here). A coarse per-area hash
    // makes whole ~4-tile patches lean wooded or clear, so stands cluster into small forests
    // instead of a uniform sprinkle; sparse areas still get the odd lone tree. Deterministic
    // off the world tile, so a wood stays put as the map window recentres.
    if (!it.c.bt && !it.c.road && GRASS_BIOMES.has(bi) && !nearField(map, it.rx, it.ry)) {
      const areaBias = frac(Math.floor(it.wx / 4) * 71.7 + Math.floor(it.wy / 4) * 131.3);   // shared over a ~4-tile patch
      const tileRoll = frac(it.wx * 57.1 + it.wy * 199.7);
      const bias = RENDER_TUNE.treeForest;
      const density = (areaBias > bias ? 0.32 + (areaBias - bias) * 1.3 : areaBias * 0.12) * RENDER_TUNE.treeDensity;   // wooded patch vs. lone trees, scaled by the Trees slider
      if (tileRoll < density) emitFace(od, () => drawTreeBB(ctx, cam, it.dx, it.dy, night, it.seed, alpha));
      continue;
    }
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
    // Emit THIS building's faces into the SHARED world sink (opened before the loop): its sub-parts
    // depth-sort against each other AND against every other building's faces, so a tower/marquee
    // can't over-paint nearer geometry of the same building OR of a neighbour (the "see-through"
    // bug). One flushFaces() after the loop paints the whole district back→front.
    // Distance LOD: past RENDER_TUNE.lodNear a dedicated model is drawn from its captured segments
    // rather than by running its arm — same mass at the handover, dissolving to one box by lodFar.
    // drawModelLOD returns false when a model has no usable capture, in which case we run the real
    // arm as before, so a capture failure costs framerate and never correctness.
    const lodN = RENDER_TUNE.lodNear || 0;
    let drewLod = false;
    if (m && lodN > 0 && it.f > lodN) {
      const lodF = Math.max(lodN + 0.001, RENDER_TUNE.lodFar || 32);
      const detail = clamp(1 - (it.f - lodN) / (lodF - lodN), 0, 1);
      drewLod = drawModelLOD(ctx, cam, it.dx, it.dy, fh, h, m, it.seed, night, alpha, face, detail);
    }
    if (drewLod) {
      // Mass came from segments; now run the REAL arm with mass suppressed so the building keeps
      // every light and sign it had. This is what makes the LOD nearly lossless: adornments are
      // only ~120 faces per frame across the whole skyline against ~2750 of mass, so keeping them
      // costs almost nothing and dropping them cost the only part of a distant building you can
      // actually see. Set lodAdorn 0 to trade that back for the last slice of speed.
      const tier = RENDER_TUNE.lodAdorn | 0;
      if (tier > 0) {
        MASS_OFF = true; ADORN_TIER = Math.min(tier, ADORN_RICH);
        try { drawTypeModel(ctx, cam, it.dx, it.dy, fh, h, m, it.seed, night, alpha, now, face, it.c.bn); }
        finally { MASS_OFF = false; ADORN_TIER = ADORN_RICH; }   // never leave either set — an arm that throws would blank every building behind it
      }
    }
    else if (m) drawTypeModel(ctx, cam, it.dx, it.dy, fh, h, m, it.seed, night, alpha, now, face, it.c.bn);
    else drawBuilding(ctx, cam, it.dx, it.dy, fh, h, arch, it.seed, night, alpha, now);
    // Rooftop holo-ad: a flickering translucent sign floating over ~1 in 4 tall-ish city
    // buildings at night — post-singularity advertising, half its pixels dead. Generic
    // buildings only: named landmarks (m) carry their own bespoke rooftop signage.
    // Rooftop decorations (holo-ad + window bloom) are only a few px at range — cull them past decoFar
    // so a dense skyline doesn't pay for signage nobody can read. Near buildings keep the full treatment.
    const decoNear = it.f < (RENDER_TUNE.decoFar || Infinity);
    if (decoNear && !m && night > 0.3 && h > 0.35 && (it.seed % 7) === 0) drawHoloAd(ctx, cam, it.dx, it.dy, fh, h, it.seed, now, alpha * night);   // rooftop holo-ad on ~1 in 7 tall buildings (was 1 in 4 — too many flickering at once)
    // Warm bloom over the lit windows so near towers read as emitting light at night.
    if (decoNear && night > 0.45) drawCityBloom(ctx, cam, it.dx, it.dy, h, night, alpha);
  }
  // Ground AA emplacements ride the SHARED face queue too (each turret emitted at its tile-centre
  // depth), so a building between you and the site occludes it instead of the turret painting on top
  // — it used to draw as a post-pass after flushFaces (the "AA showing through a building" bug).
  if (v.aaSites && (v.worldBlend ?? 1) > 0.02) drawAASites(ctx, cam, v, now);
  pEnd();                      // ── end world:build (queueing) ──
  pBegin('world:flush');
  flushFaces();   // ONE depth-sorted paint across every building + object collected this pass
  pEnd();
  // Dev overlay: the captured shapes, stroked on top of the finished frame. Off unless asked for.
  if (RENDER_TUNE.shapeWire) {
    for (const it of items) {
      if (!it.c || !it.c.bt || it.f > (RENDER_TUNE.lodFar || 32)) continue;
      const wm = modelFor(it.c); if (!wm) continue;
      const wsegs = shapeForModel(wm, it.seed); if (!wsegs || !wsegs.length) continue;
      const wh = floorHeight(it.c, it.seed);
      const wfh = (BUILDING_FOOT + frac(it.seed + 2) * 0.06) * RENDER_TUNE.bldgFoot;
      const order = lodOrder(wsegs);
      drawShapeWire(ctx, cam, it.dx, it.dy, wfh, wh, wm, it.seed, faceVec(it.c.ent), order.byIndex.find(r => r.at <= 0)?.i ?? -1);
    }
  }
  FOG_STATE = null; LIGHT_STATE = null;   // scoped to this world pass only — never bleed into the HUD/deck/yacht draws
}

// The town-square monument: a heroic bronze figure on a stone plinth, ringed by a working
// fountain (stone basin + water pool with travelling ripples + jets), uplit at night. Built
// through the shared camera so it sits, sized and receding, on the plaza tile.
function drawStatue(ctx, cam, dx, dy, fh, seed, night, alpha, now) {
  const R = fh * 0.96;                                    // fountain basin radius (tiles)
  const ring = (rad, z) => { const pts = []; for (let i = 0; i <= 18; i++) { const a = i / 18 * Math.PI * 2, p = cam.proj(dx + Math.cos(a) * rad, dy + Math.sin(a) * rad, z); if (p.f <= 0.06) return null; pts.push(p); } return pts; };
  const trace = (pts) => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.closePath(); };
  const basin = ring(R, 0.012); if (!basin) return;
  ctx.save(); ctx.globalAlpha = alpha;
  // 1. Fountain — stone rim + water pool + a couple of expanding ripple rings.
  ctx.fillStyle = 'rgb(122,120,124)'; trace(basin); ctx.fill();
  const water = ring(R * 0.8, 0.016);
  if (water) {
    ctx.fillStyle = night ? 'rgb(26,54,80)' : 'rgb(58,120,152)'; trace(water); ctx.fill();
    ctx.strokeStyle = 'rgba(205,232,246,0.35)'; ctx.lineWidth = 1;
    for (let k = 0; k < 2; k++) { const t2 = ((now * 0.0006 + k * 0.5) % 1), rr = ring(R * 0.8 * (0.3 + 0.6 * t2), 0.02); if (rr) { ctx.globalAlpha = alpha * (1 - t2) * 0.5; trace(rr); ctx.stroke(); } }
    ctx.globalAlpha = alpha;
  }
  // 2. Stone plinth.
  const plinthTop = 0.3, figTop = 0.92;
  draw3DBoxAt(ctx, cam, dx, dy, fh * 0.24, 0, plinthTop, '__statue_stone', seed, night, alpha, true);
  // 3. Bronze figure — a verdigris silhouette (torso, head, a raised arm holding a rod),
  //    drawn in screen space above the plinth and scaled by its projected height.
  const base = cam.proj(dx, dy, plinthTop), top = cam.proj(dx, dy, figTop);
  if (base.f > 0.12 && top.f > 0.12) {
    const s = Math.max(3, Math.abs(base.sy - top.sy)), cx = (base.sx + top.sx) / 2, cyB = base.sy, cyT = top.sy;
    const bronze = night ? 'rgb(64,92,80)' : 'rgb(118,136,96)', wB = s * 0.17;
    ctx.fillStyle = bronze;
    ctx.beginPath();
    ctx.moveTo(cx - wB, cyB); ctx.lineTo(cx - wB * 0.55, cyT + s * 0.26); ctx.lineTo(cx - wB * 0.5, cyT + s * 0.1);
    ctx.lineTo(cx + wB * 0.5, cyT + s * 0.1); ctx.lineTo(cx + wB * 0.55, cyT + s * 0.26); ctx.lineTo(cx + wB, cyB);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cyT, s * 0.1, 0, 7); ctx.fill();                                   // head
    ctx.strokeStyle = bronze; ctx.lineWidth = Math.max(1, s * 0.06);
    ctx.beginPath(); ctx.moveTo(cx + wB * 0.4, cyT + s * 0.22); ctx.lineTo(cx + wB * 1.7, cyT - s * 0.12); ctx.stroke();   // raised arm
    ctx.strokeStyle = night ? 'rgba(96,116,104,0.9)' : 'rgba(104,120,84,0.9)'; ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.beginPath(); ctx.moveTo(cx + wB * 1.7, cyT - s * 0.12); ctx.lineTo(cx + wB * 2.9, cyT - s * 0.6); ctx.stroke();    // the fisherman's rod
  }
  // 4. Water jets — bright sprays from the basin, breathing with time.
  ctx.strokeStyle = night ? 'rgba(150,200,232,0.55)' : 'rgba(222,240,250,0.6)'; ctx.lineWidth = 1.4;
  for (const off of [-0.34, 0, 0.34]) {
    const hgt = 0.02 + 0.15 * (0.7 + 0.3 * Math.sin(now * 0.004 + off * 6));
    const j0 = cam.proj(dx + off * R, dy, 0.02), j1 = cam.proj(dx + off * R, dy, hgt);
    if (j0.f > 0.12 && j1.f > 0.12) { ctx.beginPath(); ctx.moveTo(j0.sx, j0.sy); ctx.lineTo(j1.sx, j1.sy); ctx.stroke(); }
  }
  // 5. Night — warm uplight on the figure + a cool glimmer off the pool.
  if (night) { glowPool(ctx, cam, dx, dy, figTop * 0.6, '255,220,150', 15, alpha * 0.32); glowPool(ctx, cam, dx, dy, 0.02, '90,160,205', 18, alpha * 0.22); }
  ctx.restore();
}

// The South Gate — the Curtain's single lit breach, a fortified sally-port straddling the road.
// Two battered blast-pylons flank the road gap; a heavy lintel beam bridges them; the Curtain's
// "hard light" energy field fills the arch ABOVE the road (a lit gap you fly/drive through, open
// at the bottom); a turret mast crowns each pylon (a barrel tracking out over the killing ground,
// red blink) and hazard strobes wash the scorched threshold. `axis` is the Curtain run on its
// neighbours (curtainRun) — the wall runs along it, so the pylons stand on the wall line and the
// road passes through the perpendicular gap. Rises above CURTAIN_H so the gate reads as the
// tallest, most deliberate thing on the whole perimeter.
const GATE_H = 1.05;
function drawSouthGate(ctx, cam, dx, dy, foot, axis, seed, night, alpha, now) {
  const ew = axis.indexOf('e') >= 0 || axis.indexOf('w') >= 0;
  const wx = ew ? 1 : 0, wy = ew ? 0 : 1;          // unit along the wall (where the pylons sit)
  const gx = ew ? 0 : 1, gy = ew ? 1 : 0;          // unit along the road gap (perpendicular, points "out")
  const po = 0.34, pf = 0.15;                       // pylon offset from tile centre + half-footprint
  const pal = 'ty_gate', palDk = 'ty_gate_dk';
  // 1. Two flanking blast-pylons — a battered three-box stack each (base → setback shaft → overhang cap).
  for (const s of [-1, 1]) {
    const px = dx + wx * po * s, py = dy + wy * po * s;
    draw3DBoxAt(ctx, cam, px, py, foot * pf,        0,             GATE_H * 0.55, pal,   seed + s,     night, alpha, true);
    draw3DBoxAt(ctx, cam, px, py, foot * pf * 0.82, GATE_H * 0.55, GATE_H * 0.94, pal,   seed + 2 + s, night, alpha, true);
    draw3DBoxAt(ctx, cam, px, py, foot * pf * 1.14, GATE_H * 0.94, GATE_H,        palDk, seed + 4 + s, night, alpha, true);
  }
  // 2. Heavy lintel beam bridging the pylons over the road — three squat boxes across the wall span.
  for (const t of [-0.17, 0, 0.17]) {
    const lx = dx + wx * t, ly = dy + wy * t;
    draw3DBoxAt(ctx, cam, lx, ly, foot * 0.14, GATE_H * 0.8, GATE_H * 0.94, palDk, seed + 9 + t * 100, night, alpha, true);
  }
  // 3. The Curtain "hard light" field filling the arch above the road — a translucent shimmering
  //    panel between the pylons' inner faces, from road-clearance up to the lintel underside. Open
  //    below (the drive/fly-through). Additive cyan→violet with descending energy rain + a crown line.
  {
    const inr = po - pf * 0.35, z0 = GATE_H * 0.34, z1 = GATE_H * 0.8;
    const ax = dx - wx * inr, ay = dy - wy * inr, bx = dx + wx * inr, by = dy + wy * inr;
    const tA = cam.proj(ax, ay, z1), tB = cam.proj(bx, by, z1), bA = cam.proj(ax, ay, z0), bB = cam.proj(bx, by, z0);
    if (tA.f > 0.1 && tB.f > 0.1 && bA.f > 0.1 && bB.f > 0.1) {
      ctx.save();
      ctx.beginPath(); ctx.moveTo(tA.sx, tA.sy); ctx.lineTo(tB.sx, tB.sy); ctx.lineTo(bB.sx, bB.sy); ctx.lineTo(bA.sx, bA.sy); ctx.closePath();
      const topY = (tA.sy + tB.sy) / 2, botY = (bA.sy + bB.sy) / 2, span = (botY - topY) || 1;
      const pulse = 0.5 + 0.5 * Math.sin(now / 320);
      const g = ctx.createLinearGradient(0, topY, 0, botY);
      g.addColorStop(0,   `rgba(225,252,255,${0.55 * alpha})`);
      g.addColorStop(0.5, `rgba(110,215,255,${(0.30 + 0.12 * pulse) * alpha})`);
      g.addColorStop(1,   `rgba(120,120,255,${(0.16 + 0.08 * pulse) * alpha})`);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g; ctx.fill(); ctx.clip();
      const lerp = (t, side) => side === 0
        ? { x: tA.sx + (bA.sx - tA.sx) * t, y: tA.sy + (bA.sy - tA.sy) * t }
        : { x: tB.sx + (bB.sx - tB.sx) * t, y: tB.sy + (bB.sy - tB.sy) * t };
      for (let k = 0; k < 8; k++) {
        const t = (now / 900 + k / 8) % 1, pA = lerp(t, 0), pB = lerp(t, 1);
        ctx.strokeStyle = `rgba(210,248,255,${(0.06 + 0.12 * (1 - t)) * alpha})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pA.x, pA.y); ctx.lineTo(pB.x, pB.y); ctx.stroke();
      }
      ctx.strokeStyle = `rgba(230,254,255,${(0.6 + 0.3 * pulse) * alpha})`; ctx.lineWidth = 2;   // hot crown line under the lintel
      ctx.beginPath(); ctx.moveTo(tA.sx, tA.sy); ctx.lineTo(tB.sx, tB.sy); ctx.stroke();
      ctx.restore();
    }
  }
  // 4. Turret mast per pylon: a housing, a barrel raked out over the killing ground, a tracking blink,
  //    and an aviation-lit sensor mast above. Plus floodlit scorched threshold + a warm gap wash.
  for (const s of [-1, 1]) {
    const px = dx + wx * po * s, py = dy + wy * po * s;
    draw3DBoxAt(ctx, cam, px, py, foot * pf * 0.42, GATE_H, GATE_H * 1.14, 'ty_door', seed + 6 + s, night, alpha, true);   // turret housing
    { const bx = px + gx * 0.14, by = py + gy * 0.14; draw3DBoxAt(ctx, cam, bx, by, foot * 0.05, GATE_H * 1.04, GATE_H * 1.09, 'ty_door', seed + 7 + s, night, alpha, false); }   // barrel, raked outward
    blinkLight(ctx, cam, px, py, GATE_H * 1.18, '255,80,72', now, seed + s, alpha, 1.5);
    mast(ctx, cam, px, py, GATE_H * 1.14, GATE_H * 1.5, alpha, now, seed + s);
    if (night) glowPool(ctx, cam, px, py, 0.02, '255,210,150', 10, alpha * 0.4);   // pylon floodlight spill on the road
  }
  // The lit throat of the gap — a cold energy wash on the threshold, brighter at night.
  { const gxp = dx + gx * 0.28, gyp = dy + gy * 0.28; glowPool(ctx, cam, gxp, gyp, 0.02, '150,225,255', 14, alpha * (night ? 0.5 : 0.28)); }
  blinkLight(ctx, cam, dx, dy, GATE_H * 0.96, '255,190,90', now, seed + 3, alpha, 1.8);   // amber gate beacon on the lintel
}

// The Echelon — a long, low, mirror-black superyacht sitting on the open water, bow to the
// north, with a lit helipad aft (the tile a VTOL sets down on). Built world-fixed from a
// spine of tapered hull boxes + a stepped deck house + a raised pad, so the sea (drawn by
// the floor pass beneath) laps around the hull instead of runway concrete.
// The Echelon — a genuinely high-poly superyacht, built as a real triangulated hull rather than a
// stack of boxes: cross-section stations (beam + sheer curves) swept fore→aft into a surface with a
// chine knuckle, a cambered deck, a transom, a two-tier glass deckhouse, a radar arch, and railings.
// Every face carries a world normal, so the whole model is depth-sorted (painter, far→near),
// backface-culled, and lit by the real sun (`sun`) — the same directional shading the aircraft use —
// falling back to a top-lit key at night. Shares the one function used by BOTH the flight sim and
// the Helm chase view. heading 0 = bow north (−y), matching drawAircraftModel so a chase cam frames
// her stern; a moored/streamed Echelon (no heading) renders bow-north.
function drawYacht(ctx, cam, dx, dy, fh, seed, night, alpha, now, wake, heading, sun) {
  const hr = (heading || 0) * Math.PI / 180, shr = Math.sin(hr), chr = Math.cos(hr);
  const isNight = night > 0.35;
  // Size exaggeration: SZ lifts her HEIGHT (freeboard + superstructure) so she isn't flat and dwarfs a
  // helicopter on her pad; SB widens her beam a touch for bulk. Fore-aft (oy) is LEFT ALONE so her
  // length + pad position — and the deck-landing capture math keyed off them — are unchanged.
  // SZ = height exaggeration, SB = beam widen. Both ride on YACHT_SCALE so shrinking her keeps her
  // proportions exactly (uniform scale of the whole local frame — see YACHT_SCALE). ox/oy are scaled
  // in W(), so every part of the hull, superstructure and pad shrinks together.
  const SZ = YACHT_H * YACHT_SCALE, SB = 1.72;
  const W = (ox, oy) => { const sx = ox * YACHT_SCALE, sy = oy * YACHT_SCALE; return [dx - sy * shr + sx * SB * chr, dy + sy * chr + sx * SB * shr]; };    // local (beam,fore-aft) → world tile
  const proj = (ox, oy, z) => { const w = W(ox, oy); return cam.proj(w[0], w[1], z * SZ); };
  const wv = (ox, oy, z) => { const w = W(ox, oy); return [w[0], w[1], z * SZ]; };         // local → world 3-vector (for normals)

  // 0. Wake — carried ONLY when under way (the Helm view / a just-sailed yacht set cell.wake.spd);
  //    a moored Echelon passes none, so ordinary fly-bys are unchanged. Drawn first, on the water.
  if (wake && wake.spd > 0.02) drawYachtWake(ctx, cam, dx, dy, hr, night, alpha, now, Math.min(1.2, wake.spd), wake.turn || 0);

  // ── Palette — MIRROR BLACK ──
  // Near-black everywhere; the gloss is not in the base colour but in a tight sun SPECULAR + a cool
  // sky RIM added at shade time (below), the way a polished black hull flashes bright highlights over
  // an almost-black body. Only the sun-pads (PALE) and pool stay light, to read against the black.
  const HULL_LO = [5, 7, 10], HULL_HI = [11, 14, 20], TRANSOM = [4, 6, 9], DECK = [13, 16, 22],
        HOUSE = [7, 10, 15], ROOF = [13, 16, 23], GLASS = [16, 27, 44], PAD = [15, 19, 27],
        LOUNGE = [19, 23, 32], POOL = [22, 50, 76], PALE = [118, 126, 140], DOME = [8, 11, 17];
  const EDGE = isNight ? 'rgba(120,150,185,0.16)' : 'rgba(0,0,0,0.30)';
  const GEDGE = isNight ? 'rgba(150,190,230,0.30)' : 'rgba(150,175,205,0.24)';

  // ── Hull geometry: cross-section stations [t (0=bow→1=stern), half-beam, sheer height] ──
  // NEEDLE hull (Black-Swan blade): a razor bow drawn to a fine point right at the waterline, a very
  // long low foredeck, a low near-flat sheer (barely any freeboard), a narrow beam carried well aft,
  // and a tapered transom — a blade lying on the water, not a beamy motoryacht. The forward stations
  // grow the beam SLOWLY so the entry is a long fine spike. [t (0=bow→1=stern), half-beam, sheer].
  // Raised freeboard: the sheer (3rd value) is ~1.85× the old blade so much more of the black hull SIDE
  // stands off the sea — she reads as a big ship with real topside, and the helipad sits deeper in her
  // deck (the heli nestles further down the recess).
  const ST = [
    [0.00, 0.000, 0.052], [0.05, 0.010, 0.059], [0.12, 0.030, 0.067], [0.22, 0.062, 0.074],
    [0.35, 0.096, 0.078], [0.50, 0.116, 0.081], [0.66, 0.120, 0.085], [0.80, 0.112, 0.089],
    [0.91, 0.098, 0.093], [1.00, 0.078, 0.096],
  ];
  const N = ST.length, BOW = -1.24, LEN = 2.08, OY = (t) => BOW + t * LEN;   // ~2.1 tiles of blade: a longer spike bow forward, transom well aft (transom oy 0.84 unchanged — pad-capture frame untouched)
  const hbsz = (oy) => { const t = clamp((oy - BOW) / LEN, 0, 1); let i = 0; while (i < N - 2 && ST[i + 1][0] < t) i++; const a = ST[i], b = ST[i + 1], u = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0; return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; };

  const faces = [];
  const F = (p, col, o) => faces.push(Object.assign({ p, col }, o));

  // Topsides — two bands per side (waterline→chine knuckle, chine→sheer) swept between stations, so
  // the flank is a curved surface with a real knuckle line, not a flat slab. Deck panels (port/star,
  // cambered to a centreline crown) cap each bay. The bow station (hb≈0) closes the surface to a point.
  for (let i = 0; i < N - 1; i++) {
    const [t0, hb0, sz0] = ST[i], [t1, hb1, sz1] = ST[i + 1], oy0 = OY(t0), oy1 = OY(t1);
    const wb0 = hb0 * 0.70, wb1 = hb1 * 0.70, cb0 = hb0 * 0.99, cb1 = hb1 * 0.99, cz0 = sz0 * 0.42, cz1 = sz1 * 0.42;
    for (const s of [-1, 1]) {
      F([[s * wb0, oy0, 0], [s * wb1, oy1, 0], [s * cb1, oy1, cz1], [s * cb0, oy0, cz0]], HULL_LO, { edge: EDGE });
      F([[s * cb0, oy0, cz0], [s * cb1, oy1, cz1], [s * hb1, oy1, sz1], [s * hb0, oy0, sz0]], HULL_HI, { edge: EDGE });
    }
    const cam0 = 0.004, cam1 = 0.004;
    F([[-hb0, oy0, sz0], [0, oy0, sz0 + cam0], [0, oy1, sz1 + cam1], [-hb1, oy1, sz1]], DECK);
    F([[hb0, oy0, sz0], [0, oy0, sz0 + cam0], [0, oy1, sz1 + cam1], [hb1, oy1, sz1]], DECK);
  }
  { const [, hb, sz] = ST[N - 1], oy = OY(1), wb = hb * 0.70;   // transom
    F([[-wb, oy, 0], [wb, oy, 0], [hb, oy, sz], [-hb, oy, sz]], TRANSOM, { edge: EDGE }); }

  // Smoked-glass window band down the topside — the long lit strip of a superyacht flank, running the
  // length of her black hull.
  for (let i = 2; i < N - 1; i++) {
    const [, hb0, sz0] = ST[i], [, hb1, sz1] = ST[i + 1], oy0 = OY(ST[i][0]), oy1 = OY(ST[i + 1][0]);
    for (const s of [-1, 1]) F([[s * hb0 * 0.992, oy0, sz0 * 0.60], [s * hb1 * 0.992, oy1, sz1 * 0.60], [s * hb1 * 0.992, oy1, sz1 * 0.90], [s * hb0 * 0.992, oy0, sz0 * 0.90]], GLASS, { glass: 1 });
  }

  // Long, low, STEPPED superstructure — a layered "wedding-cake" deckhouse rising in three set-back
  // tiers (main saloon → upper saloon → bridge) instead of one tall slab, so she reads as a real
  // multi-deck megayacht rather than a billboard jutting off the deck. Each tier is shorter, narrower
  // and set back from the one below, with a raked dark-glass windshield and inward-leaning glass flanks.
  const DECKZ = 0.085;   // main deck — RAISED with the freeboard so the hull side stands well off the sea
  // tier(fore, aft, base half-width, top half-width, z-bottom, z-top): one glass-walled deck box with a
  // raked windshield up front and a flat roof; stacked, each rooftop becomes the next tier's floor. The
  // top climbs gradually over the length of the ship, so the profile steps up instead of jumping.
  const tier = (fore, aft, hw, hwT, z0, z1) => {
    const foreT = fore + 0.05;   // windshield rake — the top front sits back from the base front
    for (const s of [-1, 1])
      F([[s * hw, fore, z0], [s * hw, aft, z0], [s * hwT, aft, z1], [s * hwT, foreT, z1]], GLASS, { glass: 1, edge: GEDGE });   // inward-leaning glass flank
    F([[-hw, fore, z0], [hw, fore, z0], [hwT, foreT, z1], [-hwT, foreT, z1]], GLASS, { glass: 1, edge: GEDGE });                 // raked windshield
    F([[-hw, aft, z0], [hw, aft, z0], [hwT, aft, z1], [-hwT, aft, z1]], HOUSE, { edge: EDGE });                                  // aft face
    F([[-hwT, foreT, z1], [hwT, foreT, z1], [hwT, aft, z1], [-hwT, aft, z1]], ROOF, { edge: EDGE });                             // roof — next tier's floor / open deck
  };
  // HALVED height: the cabin now rises only ~half as far above the (raised) deck, so it reads as a low,
  // set-back deckhouse on a big-freeboard hull instead of a tall block.
  tier(-0.44, 0.16, 0.112, 0.104, DECKZ, 0.120);   // main-deck saloon — a BROAD, low base filling the wide beam
  tier(-0.34, 0.11, 0.088, 0.080, 0.120, 0.145);   // upper saloon, set back
  tier(-0.25, 0.05, 0.066, 0.058, 0.145, 0.163);   // bridge / sun deck, set back again
  const SUNZ = 0.163;    // top-tier roof: the mast + antennas ride here
  // Aft sun deck between the bridge and the helipad, on the main-deck roof — a couple of loungers, the
  // light dressing that reads against the long black superstructure.
  { const z = 0.120 + 0.002;
    for (const oy of [0.118, 0.142]) F([[-0.05, oy, z], [0.05, oy, z], [0.05, oy + 0.02, z], [-0.05, oy + 0.02, z]], PALE); }   // aft sun-loungers

  // Sunken forward lounge — a recessed cockpit with pale sun-pads + a plunge pool: the signature
  // light patch on the long foredeck, glowing against the black hull.
  { const lz = DECKZ - 0.006;
    F([[-0.066, -0.66, lz], [0.066, -0.66, lz], [0.066, -0.46, lz], [-0.066, -0.46, lz]], LOUNGE);                                   // recessed sole
    F([[-0.044, -0.58, lz + 0.002], [0.044, -0.58, lz + 0.002], [0.044, -0.49, lz + 0.002], [-0.044, -0.49, lz + 0.002]], POOL, { glass: 1 });   // plunge pool
    for (const oy of [-0.64, -0.60]) F([[-0.05, oy, lz + 0.006], [0.05, oy, lz + 0.006], [0.05, oy + 0.026, lz + 0.006], [-0.05, oy + 0.026, lz + 0.006]], PALE);   // sun-pads
  }

  // Aft deck fittings — low faceted domes (tenders / tech) dressing the long after deck between the
  // pad and the transom, catching the light off her flanks.
  for (const [ox, oy, r] of [[-0.05, 0.50, 0.026], [0.05, 0.50, 0.026], [0, 0.60, 0.032], [-0.045, 0.70, 0.024], [0.045, 0.70, 0.024]]) {
    const zt = DECKZ + 0.022, rc = r * 0.5;
    F([[ox - r, oy - r, DECKZ], [ox + r, oy - r, DECKZ], [ox + rc, oy - rc, zt], [ox - rc, oy - rc, zt]], DOME, { edge: EDGE });
    F([[ox - r, oy + r, DECKZ], [ox + r, oy + r, DECKZ], [ox + rc, oy + rc, zt], [ox - rc, oy + rc, zt]], DOME, { edge: EDGE });
    for (const s of [-1, 1]) F([[ox + s * r, oy - r, DECKZ], [ox + s * r, oy + r, DECKZ], [ox + s * rc, oy + rc, zt], [ox + s * rc, oy - rc, zt]], DOME, { edge: EDGE });
    F([[ox - rc, oy - rc, zt], [ox + rc, oy - rc, zt], [ox + rc, oy + rc, zt], [ox - rc, oy + rc, zt]], DOME);   // cap
  }

  // Fold-down beach/swim platform stepping off the transom to the water — the aftmost flourish.
  { const oy = OY(1), hb = ST[N - 1][1], pw = hb * 0.72;
    F([[-pw, oy, 0.006], [pw, oy, 0.006], [pw, oy + 0.06, 0.001], [-pw, oy + 0.06, 0.001]], DECK, { edge: EDGE }); }

  // Helipad — a pad FLUSH with the main deck (pZ1 = DECKZ) so a parked helicopter rests ON the deck, not
  // sunk into a well. A very low coaming lip (rimZ) rings it — a proper helideck edge, not a pit. The
  // painted ring + "H" are stroked in the overlay pass. pZ1 is the world-z the auto-land / deck-cam meet.
  const pO0 = 0.16, pO1 = 0.40, pHW = 0.108, pZ0 = DECKZ, pZ1 = DECKZ, rimZ = DECKZ + 0.010, padOY = (pO0 + pO1) / 2, padR = 0.088;
  F([[-pHW, pO0, pZ1], [pHW, pO0, pZ1], [pHW, pO1, pZ1], [-pHW, pO1, pZ1]], PAD);   // flush pad floor
  // Low coaming lip (deck up to rimZ) on all four sides — the helideck edge.
  F([[-pHW, pO0, rimZ], [pHW, pO0, rimZ], [pHW, pO0, pZ1], [-pHW, pO0, pZ1]], HOUSE, { edge: EDGE });   // forward
  F([[-pHW, pO1, rimZ], [pHW, pO1, rimZ], [pHW, pO1, pZ1], [-pHW, pO1, pZ1]], HOUSE, { edge: EDGE });   // aft
  for (const s of [-1, 1]) F([[s * pHW, pO0, rimZ], [s * pHW, pO1, rimZ], [s * pHW, pO1, pZ1], [s * pHW, pO0, pZ1]], HOUSE, { edge: EDGE });   // port / starboard

  // ── Lighting: directional sun (as the aircraft use), else a top-lit key at night ──
  let toSun = null;
  if (sun && sun.elev > 0.02 && !isNight) {
    const e = clamp(sun.elev, 0, 1), hz = Math.sqrt(Math.max(0, 1 - e * e)), m = Math.hypot(sun.dir[0] * hz, sun.dir[1] * hz, e) || 1;
    toSun = [sun.dir[0] * hz / m, sun.dir[1] * hz / m, e / m];
  }
  const camPos = [-(cam.back || 0) * cam.sinh, (cam.back || 0) * cam.cosh, cam.EH];   // eye position in world
  const ctr = [dx, dy, 0.04 * SZ];   // hull centre — used to orient every face's normal outward
  // Which flank faces the camera (+ = starboard near). Railings/edge-lights on the FAR side would draw
  // over the opaque hull + superstructure (they're a flat overlay with no depth test), so we only draw
  // the near side — the far rail no longer shows through the ship.
  const beamDot = chr * (camPos[0] - ctr[0]) + shr * (camPos[1] - ctr[1]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // ── Project, backface-cull, NEAR-PLANE CLIP, depth-sort (far→near), shade, fill ──
  // Faces crossing the camera near plane are CLIPPED to it, not dropped — otherwise, with the deck-cam
  // sitting right on the pad, the close hull/deck faces vanish and you see straight through the ship.
  const NEARF = 0.12;
  const camF = (w) => (w[0] + cam.back * cam.sinh) * cam.sinh - (w[1] - cam.back * cam.cosh) * cam.cosh;   // camera-forward depth of a world point
  const clipNearF = (wp) => {   // Sutherland–Hodgman clip against f >= NEARF, in world space
    const out = [];
    for (let i = 0; i < wp.length; i++) {
      const A = wp[i], B = wp[(i + 1) % wp.length], fa = camF(A), fb = camF(B), ina = fa >= NEARF, inb = fb >= NEARF;
      if (ina) out.push(A);
      if (ina !== inb) { const t = (NEARF - fa) / (fb - fa); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]); }
    }
    return out;
  };
  const draw = [];
  for (const fc of faces) {
    const wp = fc.p.map((p) => wv(p[0], p[1], p[2]));
    const w0 = wp[0], w1 = wp[1], w2 = wp[2];
    const e1 = sub(w1, w0), e2 = sub(w2, w0);
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nm = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / nm, n[1] / nm, n[2] / nm];
    const cen = [(w0[0] + w1[0] + w2[0]) / 3, (w0[1] + w1[1] + w2[1]) / 3, (w0[2] + w1[2] + w2[2]) / 3];
    if (dot(n, sub(cen, ctr)) < 0) n = [-n[0], -n[1], -n[2]];   // orient outward from the hull centre
    if (dot(n, sub(camPos, cen)) <= 0) continue;                // backface → skip
    const cw = clipNearF(wp); if (cw.length < 3) continue;      // fully behind the near plane → gone
    const sp = cw.map((w) => cam.proj(w[0], w[1], w[2]));
    let af = 0; for (const q of sp) af += q.f; af /= sp.length;
    // Mirror-black shading: a LOW dark diffuse (so the body stays near-black) + a tight sun SPECULAR
    // (Blinn half-vector, high exponent → a small bright glossy flash) + a cool sky RIM at grazing
    // angles (fresnel). The last two are added, not multiplied, so they light black facets up.
    const lm = toSun ? clamp(0.30 + 0.5 * Math.max(0, dot(n, toSun)) + 0.06 * Math.max(0, n[2]), 0.14, 1.05)
                     : clamp(0.22 + 0.34 * Math.max(0, n[2]), 0.14, 0.85);
    const cd = sub(camPos, cen), cdm = Math.hypot(cd[0], cd[1], cd[2]) || 1, camDir = [cd[0] / cdm, cd[1] / cdm, cd[2] / cdm];
    let spec = 0;
    if (toSun) { const h = [toSun[0] + camDir[0], toSun[1] + camDir[1], toSun[2] + camDir[2]], hm = Math.hypot(h[0], h[1], h[2]) || 1; spec = Math.pow(Math.max(0, (n[0] * h[0] + n[1] * h[1] + n[2] * h[2]) / hm), 26); }
    const rim = Math.pow(1 - Math.max(0, dot(n, camDir)), 3);
    draw.push({ sp, col: fc.col, glass: fc.glass, edge: fc.edge, lm, spec, rim, af });
  }
  draw.sort((a, b) => b.af - a.af);
  ctx.globalAlpha = 1;
  for (const it of draw) {
    let r = it.col[0] * it.lm, g = it.col[1] * it.lm, b = it.col[2] * it.lm;
    if (it.glass) { r += 14; g += 22; b += 36; }                       // smoked glass lifts a cool sky reflection
    r += it.spec * 175 + it.rim * 24; g += it.spec * 182 + it.rim * 38; b += it.spec * 192 + it.rim * 60;   // glossy sun glint + sky rim
    ctx.beginPath(); it.sp.forEach((q, i) => (i ? ctx.lineTo(q.sx, q.sy) : ctx.moveTo(q.sx, q.sy))); ctx.closePath();
    ctx.fillStyle = `rgba(${clamp(r, 0, 255) | 0},${clamp(g, 0, 255) | 0},${clamp(b, 0, 255) | 0},${alpha})`; ctx.fill();
    if (it.edge) { ctx.strokeStyle = it.edge; ctx.lineWidth = 1; ctx.stroke(); }
  }

  // ── Overlays: helipad ring + "H", railings, radar arch, mast beacon ──
  ctx.save(); ctx.globalAlpha = alpha;
  const ring = []; for (let i = 0; i <= 20; i++) { const a = i / 20 * Math.PI * 2, p = proj(Math.cos(a) * padR, padOY + Math.sin(a) * padR, pZ1 + 0.002); if (p.f <= 0.08) { ring.length = 0; break; } ring.push(p); }
  if (ring.length) {
    ctx.strokeStyle = isNight ? 'rgba(255,210,120,0.9)' : 'rgba(236,239,243,0.9)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ring.forEach((p, i) => i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.closePath(); ctx.stroke();
    const HP = (ox, oy) => proj(ox * padR, padOY + oy * padR, pZ1 + 0.003), hp = [HP(-0.34, -0.42), HP(-0.34, 0.42), HP(0.34, -0.42), HP(0.34, 0.42), HP(-0.34, 0), HP(0.34, 0)];
    if (hp.every(p => p.f > 0.08)) { ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(hp[0].sx, hp[0].sy); ctx.lineTo(hp[1].sx, hp[1].sy); ctx.moveTo(hp[2].sx, hp[2].sy); ctx.lineTo(hp[3].sx, hp[3].sy); ctx.moveTo(hp[4].sx, hp[4].sy); ctx.lineTo(hp[5].sx, hp[5].sy); ctx.stroke(); }
  }
  // Railings — a top rail tracing the sheer with stanchions, on the OPEN FOREDECK ONLY (bow → the
  // deckhouse front at oy −0.44). Kept forward of the superstructure so the rail never overlaps the tall
  // black tiers behind it — that overlap read as "railings through the boat". Near flank only (beamDot).
  const RAIL_AFT = -0.44;   // stop the rail at the deckhouse front
  ctx.strokeStyle = isNight ? 'rgba(205,214,228,0.55)' : 'rgba(176,188,204,0.72)'; ctx.lineWidth = 1;
  for (const s of [-1, 1]) {
    if (s * beamDot < 0) continue;   // far-side rail would show THROUGH the hull — draw only the near flank
    const line = [];
    for (let oy = -1.20; oy <= RAIL_AFT; oy += 0.04) { const [hb, sz] = hbsz(oy); const p = proj(s * hb, oy, sz + 0.017); if (p.f > 0.1) line.push(p); }
    if (line.length > 1) { ctx.beginPath(); line.forEach((p, i) => i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.stroke(); }
    for (let oy = -1.18; oy <= RAIL_AFT; oy += 0.08) { const [hb, sz] = hbsz(oy); const a = proj(s * hb, oy, sz), b = proj(s * hb, oy, sz + 0.017); if (a.f > 0.1 && b.f > 0.1) { ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); } }
  }
  // A short mast off the sun deck with a slow radar sweep + blinking beacon — kept LOW so it accents
  // the profile instead of towering over it (the old tall radar arch broke the knife silhouette).
  const sunZ = SUNZ + 0.008, mastZ = SUNZ + 0.066;   // mast rides on the (now taller) sun deck
  ctx.strokeStyle = isNight ? 'rgba(180,190,205,0.75)' : 'rgba(70,78,90,0.9)'; ctx.lineWidth = 1.4;
  const m0 = proj(0, 0.03, sunZ), m1 = proj(0, 0.03, mastZ);
  if (m0.f > 0.12 && m1.f > 0.12) {
    ctx.beginPath(); ctx.moveTo(m0.sx, m0.sy); ctx.lineTo(m1.sx, m1.sy); ctx.stroke();
    const re = proj(Math.cos(now * 0.004) * 0.045, 0.03, mastZ - 0.004);   // slow radar bar
    if (re.f > 0.1) { ctx.beginPath(); ctx.moveTo(m1.sx, m1.sy); ctx.lineTo(re.sx, re.sy); ctx.stroke(); }
    if (0.5 + 0.5 * Math.sin(now * 0.006) > 0.5) { ctx.fillStyle = 'rgba(255,90,80,0.95)'; ctx.beginPath(); ctx.arc(m1.sx, m1.sy, 2, 0, 7); ctx.fill(); }
  }
  ctx.restore();

  // ── Night dressing — cabin glow through the glass, helipad wash, running lights, sidelights ──
  if (isNight) {
    const gp = (ox, oy, z, col, r, a) => { const w = W(ox, oy); glowPool(ctx, cam, w[0], w[1], z * SZ, col, r, a); };
    gp(0, -0.08, 0.108, '255,206,150', 15, alpha * 0.5);   // saloon glow through the raked windshield
    gp(0, 0.06, 0.132, '200,220,255', 12, alpha * 0.44);   // lit sun deck / saloon top
    gp(0, -0.55, 0.082, '150,205,255', 12, alpha * 0.4);   // sunken forward lounge + plunge pool glow
    gp(0, padOY, pZ1 + 0.004, '255,200,110', 16, alpha * 0.4);   // helipad wash
    // Reactive helipad perimeter lights — a ring of green landing lights around the pad that come on
    // ONLY at night (this whole block is night-gated, so they're dark by day) + a slow amber beacon
    // at the aft rim. They give the deck a live, powered "come and land" read after dark.
    {
      ctx.save(); ctx.globalAlpha = alpha;
      const nP = 12;
      for (let i = 0; i < nP; i++) {
        const a = i / nP * Math.PI * 2, lx = Math.cos(a) * padR * 1.02, ly = padOY + Math.sin(a) * padR * 1.02;
        const p = proj(lx, ly, pZ1 + 0.004); if (p.f <= 0.1) continue;
        gp(lx, ly, pZ1 + 0.004, '110,240,150', 3.4, alpha * 0.45);   // green edge-light wash
        ctx.fillStyle = 'rgba(150,255,190,0.95)'; ctx.beginPath(); ctx.arc(p.sx, p.sy, clamp(1.5 / p.f, 0.5, 2.2), 0, 7); ctx.fill();
      }
      const bl = proj(0, padOY + padR * 1.06, pZ1 + 0.02);   // amber landing beacon, aft rim, slow pulse
      if (bl.f > 0.1 && 0.5 + 0.5 * Math.sin(now * 0.005) > 0.35) {
        gp(0, padOY + padR * 1.06, pZ1 + 0.02, '255,190,90', 8, alpha * 0.6);
        ctx.fillStyle = 'rgba(255,210,130,0.98)'; ctx.beginPath(); ctx.arc(bl.sx, bl.sy, clamp(2.2 / bl.f, 0.8, 3), 0, 7); ctx.fill();
      }
      ctx.restore();
    }
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(245,248,252,0.95)';
    for (const s of [-1, 1]) { if (s * beamDot < 0) continue; for (let oy = -1.18; oy <= 0.78; oy += 0.09) { const [hb, sz] = hbsz(oy); const p = proj(s * hb, oy, sz + 0.012); if (p.f > 0.1) { ctx.beginPath(); ctx.arc(p.sx, p.sy, clamp(2.0 / p.f, 0.6, 3.0), 0, 7); ctx.fill(); } } }
    gp(0, -1.20, 0.05, '245,248,252', 8, alpha * 0.5);   // bow steaming lamp, out at the needle tip
    for (const [s, glow, dotc] of [[-1, '255,74,64', 'rgba(255,96,86,0.98)'], [1, '70,232,126', 'rgba(96,240,150,0.98)']]) {
      const [hb, sz] = hbsz(-0.34); gp(s * hb, -0.34, sz + 0.012, glow, 7, alpha * 0.55);   // port red / starboard green
      const p = proj(s * hb, -0.34, sz + 0.012); if (p.f > 0.1) { ctx.fillStyle = dotc; ctx.beginPath(); ctx.arc(p.sx, p.sy, clamp(2.2 / p.f, 0.8, 3.2), 0, 7); ctx.fill(); }
    }
    ctx.restore();
  }
}

// Auto-land CATCH VOLUME — a holographic aiming target over the Echelon's aft helipad that shows a
// hovering helicopter exactly what to fly into to be grabbed for the auto-land: a bullseye footprint
// on the pad (the horizontal catch RADIUS) inside a translucent capture COLUMN rising to the altitude
// ceiling (the height window), with light bands sweeping UP the column like a tractor beam. Drawn in
// the same yacht-local frame as drawYacht (pad centred at oy 0.28, deck z≈0.07), so it rides the hull
// as she moves/turns. Reads FAINT CYAN as a passive target; when `armed` (the pilot is inside the
// capture window) the whole volume flips BRIGHT GREEN, the beam quickens, and "set down" chevrons
// march onto the pad — a clear "you're locked, come down" cue.
// Horizontal catch radius + capture-column height (tile units). CEIL≈0.5 sits near the ~300ft mark in
// the contact-altitude frame (CONTACT_ALT_K = 1/600), so the column top reads as "enter the gate here,
// descend, and you're grabbed at the deck" — matching the pre-capture notice (≤320ft) → capture (≤150ft).
const PAD_CATCH_R = 0.5, PAD_CATCH_CEIL = 0.5;
function drawYachtPadDome(ctx, cam, dx, dy, hr, now, alpha, armed) {
  const shr = Math.sin(hr), chr = Math.cos(hr);
  // padOY (fore-aft pad offset) + the catch radius shrink with the hull (YACHT_SCALE) so the dome rides
  // her scaled pad; baseZ tracks the flush helipad floor. CEIL is the altitude capture window (a real
  // approach height), so it stays in world-z and is NOT scaled by the hull size.
  const padOY = 0.28 * YACHT_SCALE, baseZ = 0.088 * YACHT_H * YACHT_SCALE, R = PAD_CATCH_R * YACHT_SCALE, CEIL = PAD_CATCH_CEIL;
  const P = (ox, oy, z) => cam.proj(dx - oy * shr + ox * chr, dy + oy * chr + ox * shr, z);
  const pulse = 0.5 + 0.5 * Math.sin(now * (armed ? 0.008 : 0.0035));
  const col = armed ? '86,240,150' : '120,205,255';
  const A = alpha * (armed ? 0.62 : 0.34);
  // A ring of screen points at radius r, height z — null if any vertex crosses the lens.
  const ring = (r, z, n = 30) => { const pts = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2, p = P(Math.cos(a) * r, padOY + Math.sin(a) * r, z); if (p.f <= 0.08) return null; pts.push(p); } return pts; };
  const trace = (pts) => { if (!pts) return; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.stroke(); };
  ctx.save();
  ctx.strokeStyle = `rgb(${col})`; ctx.fillStyle = `rgb(${col})`; ctx.lineJoin = 'round';

  // ── Footprint bullseye — the HORIZONTAL catch radius you must hold your hover inside ──
  const base = ring(R, baseZ);
  if (base) { ctx.globalAlpha = A * 0.14; ctx.beginPath(); base.forEach((p, i) => i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.closePath(); ctx.fill(); }   // soft target disc
  ctx.lineWidth = 2; ctx.globalAlpha = A * (0.7 + 0.3 * pulse); trace(base);                       // bright outer rim
  ctx.lineWidth = 1; ctx.globalAlpha = A * 0.5; trace(ring(R * 0.58, baseZ));                       // inner ring
  ctx.globalAlpha = A * 0.5;                                                                        // crosshair ticks
  for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), i0 = P(ca * R * 0.72, padOY + sa * R * 0.72, baseZ), i1 = P(ca * R, padOY + sa * R, baseZ); if (i0.f > 0.08 && i1.f > 0.08) { ctx.beginPath(); ctx.moveTo(i0.sx, i0.sy); ctx.lineTo(i1.sx, i1.sy); ctx.stroke(); } }
  const cpt = P(0, padOY, baseZ + 0.004); if (cpt.f > 0.08) { ctx.globalAlpha = A; ctx.beginPath(); ctx.arc(cpt.sx, cpt.sy, 2.2, 0, 7); ctx.fill(); }   // centre pip

  // ── Capture column — the VOLUME rising to the altitude ceiling; hover inside it to be caught ──
  ctx.lineWidth = 1; ctx.globalAlpha = A * 0.45; trace(ring(R, baseZ + CEIL));                      // ceiling ring
  ctx.globalAlpha = A * 0.4;                                                                        // cylinder-wall struts
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), b = P(ca * R, padOY + sa * R, baseZ), t = P(ca * R, padOY + sa * R, baseZ + CEIL); if (b.f > 0.08 && t.f > 0.08) { ctx.beginPath(); ctx.moveTo(b.sx, b.sy); ctx.lineTo(t.sx, t.sy); ctx.stroke(); } }
  // Light bands sweeping UP the column (a tractor-beam read) — quicker + brighter when armed.
  const bands = armed ? 4 : 2;
  for (let m = 0; m < bands; m++) { const ph = ((now * (armed ? 0.0011 : 0.0006) + m / bands) % 1); ctx.globalAlpha = A * (1 - ph) * (armed ? 0.7 : 0.4); ctx.lineWidth = armed ? 2 : 1.4; trace(ring(R, baseZ + CEIL * ph)); }

  // Armed: a downward "set down here" chevron stack marching onto the pad centre.
  if (armed) { ctx.lineWidth = 2; for (let k = 0; k < 3; k++) { const ph = ((now * 0.0016 + k / 3) % 1), z = baseZ + CEIL * 0.7 * (1 - ph), r = R * 0.3, cen = P(0, padOY, z), lp = P(-r, padOY, z), rp = P(r, padOY, z); if (cen.f > 0.08 && lp.f > 0.08 && rp.f > 0.08) { ctx.globalAlpha = A * (1 - ph) * 0.9; ctx.beginPath(); ctx.moveTo(lp.sx, lp.sy); ctx.lineTo(cen.sx, cen.sy); ctx.lineTo(rp.sx, rp.sy); ctx.stroke(); } } }
  ctx.restore();
}

// The Echelon's wake — foam boiling off the transom and streaming astern (+y, toward the
// chase camera) in a widening V, projected on the water surface (z≈0) through the same cam
// as the hull so it foreshortens correctly. `spd` (0..~1.2) scales length/spread/brightness.
// Only ever called for a yacht that is under way (cell.wake.spd > 0).
function drawYachtWake(ctx, cam, dx, dy, hr, night, alpha, now, spd, turn) {
  const shr = Math.sin(hr), chr = Math.cos(hr), S = YACHT_SCALE;
  // Turn-reactive curve: the water astern was laid down where the stern USED to be, so a swing
  // bows the foam trail toward the inside of the turn. `turn` is her angular velocity (deg/s,
  // signed; +starboard). Normalise to ±1 and sweep the wake laterally (local +ox = starboard), the
  // shift growing the further astern the foam is (∝ t). Zero when steaming straight → the same wake.
  const bend = Math.max(-1, Math.min(1, (turn || 0) / 40));
  const cOX = (t) => -bend * 0.6 * t;   // lateral local offset at fore-aft fraction t (0 at stern)
  // Local (beam,fore-aft) → world, scaled by YACHT_SCALE exactly like the hull's W() — so the wake hugs
  // the SHRUNK transom. Without the scale it floated a full hull-length astern of the smaller boat, as a
  // giant disconnected foam patch in open water; scaling it re-attaches it to her stern.
  const proj = (ox, oy, z) => cam.proj(dx - oy * S * shr + ox * S * chr, dy + oy * S * chr + ox * S * shr, z);
  const foam = night ? [225, 235, 245] : [245, 250, 253];
  ctx.save(); ctx.globalAlpha = alpha;

  // ── Transom wake — a widening foam V boiling off the stern and streaming astern (+oy). Sized up (the
  // scale shrank it) so she throws a proper boiling wake, scaled hard by the throttle. ──
  const sternOY = 0.86;                          // just aft of the transom
  const len = 0.55 + spd * 1.3;                  // how far the wake streams astern (local units) — ~half the old reach
  const edgeR = 0.06 + spd * 0.10, edgeF = 0.14 + spd * 0.42;   // half-width at stern / far end
  // 1. Translucent turbulence fill inside the V.
  const A = proj(-edgeR, sternOY, 0.003), B = proj(edgeR, sternOY, 0.003);
  const C = proj(edgeF + cOX(1), sternOY + len, 0.003), D = proj(-edgeF + cOX(1), sternOY + len, 0.003);
  if (A.f > 0.06 && B.f > 0.06 && C.f > 0.06 && D.f > 0.06) {
    ctx.beginPath(); ctx.moveTo(A.sx, A.sy); ctx.lineTo(B.sx, B.sy); ctx.lineTo(C.sx, C.sy); ctx.lineTo(D.sx, D.sy); ctx.closePath();
    ctx.fillStyle = rgb(foam, 0.12 + 0.20 * spd); ctx.fill();
  }
  // 2. Foam speckle streaming astern, drifting with time.
  const drift = (now * 0.00035 * (0.5 + spd)) % 1;
  const N = 34;
  for (let i = 0; i < N; i++) {
    const t = (i / N + drift) % 1;             // 0 at stern → 1 far astern (loops)
    const oy = sternOY + t * len;
    const spread = lerp(edgeR, edgeF, t) * (0.4 + frac(i * 3.1) * 0.9);
    const side = frac(i * 1.7) < 0.5 ? -1 : 1;
    const p = proj(side * spread + cOX(t), oy, 0.004);
    if (p.f <= 0.06) continue;
    ctx.globalAlpha = alpha * (1 - t) * (0.4 + 0.55 * spd);
    ctx.fillStyle = rgb(foam);
    ctx.beginPath(); ctx.arc(p.sx, p.sy, clamp((1.6 + t * 2.8) / p.f, 0.6, 8), 0, 7); ctx.fill();
  }
  // 3. Bright churn boiling right off the transom.
  const cpt = proj(0, sternOY, 0.004);
  if (cpt.f > 0.06) {
    const rr = clamp(2.6 / cpt.f, 3, 26) * (0.7 + spd);
    const g = ctx.createRadialGradient(cpt.sx, cpt.sy, 1, cpt.sx, cpt.sy, rr);
    g.addColorStop(0, rgb(foam, 0.60)); g.addColorStop(1, rgb(foam, 0));
    ctx.globalAlpha = alpha; ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cpt.sx, cpt.sy, rr, 0, 7); ctx.fill();
  }

  // ── Bow wave — a foam "moustache" peeling off the cutwater and fanning aft down each flank, so she
  // reads as slicing the water forward, not just churning astern. Bow tip is ~oy −1.12 on the fine spike
  // bow; it grows and reaches further with speed. ──
  const bowOY = -1.12, bowLen = 0.5 + spd * 1.1, bowSpread = 0.12 + spd * 0.16;
  for (const s of [-1, 1]) {
    const P0 = proj(0.01 * s, bowOY, 0.004);                        // at the cutwater
    const P1 = proj(s * bowSpread, bowOY + bowLen, 0.003);          // fanned out + aft
    const P2 = proj(s * bowSpread * 0.5, bowOY + bowLen, 0.003);
    if (P0.f > 0.06 && P1.f > 0.06 && P2.f > 0.06) {
      ctx.globalAlpha = alpha * (0.28 + 0.45 * spd);
      ctx.fillStyle = rgb(foam, 0.5);
      ctx.beginPath(); ctx.moveTo(P0.sx, P0.sy); ctx.lineTo(P1.sx, P1.sy); ctx.lineTo(P2.sx, P2.sy); ctx.closePath(); ctx.fill();
    }
  }
  // Bright spray right at the cutwater.
  const bpt = proj(0, bowOY, 0.004);
  if (bpt.f > 0.06 && spd > 0.15) {
    const rr = clamp(1.6 / bpt.f, 2, 14) * (0.6 + spd);
    const g = ctx.createRadialGradient(bpt.sx, bpt.sy, 1, bpt.sx, bpt.sy, rr);
    g.addColorStop(0, rgb(foam, 0.45)); g.addColorStop(1, rgb(foam, 0));
    ctx.globalAlpha = alpha; ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(bpt.sx, bpt.sy, rr, 0, 7); ctx.fill();
  }
  ctx.restore();
}

// 2D convex hull (Andrew's monotone chain) of a handful of screen points — used to wrap a
// building's projected box into one clean silhouette outline. Small n, called per building.
function convexHull2D(pts) {
  if (pts.length < 3) return pts;
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// A building's ground shadow. Rather than a flat constant-width beam, we project the whole BOX:
// the square footprint AND the top face slid along the sun by the height offset. The convex hull
// of those eight ground points is the box's true cast silhouette — it takes the building's
// footprint shape and stretches/skews with height and sun angle, instead of a featureless slab.
// `segs`/`E` optional: with a captured shape the shadow is cast from the building's REAL footprint
// instead of one square, so a stepped tower, an L-shaped studio lot and a long hangar stop all
// casting the same rectangle. Falls back to the square when a model has no capture.
//
// Two things this fixes beyond the outline. The old square used the raw `fh`, ignoring the 0.44
// clamp draw3DBoxAt applies internally — so every wide model already cast a shadow wider than the
// building. And the cast height was the storey stack `h`, not the model's real roof, so an office
// tower drawn to 1.7h threw a shadow sized for 1.0h. Both come out right from the segments.
function drawBuildingShadow(ctx, cam, dx, dy, fh, h, sun, alpha, segs, E) {
  let corners = null, topZ = h;
  if (segs && segs.length) {
    const local = shapeFootprint(segs, fh, h);
    if (local.length >= 3) {
      const th = E ? Math.atan2(-E[0], E[1]) : 0, ct = Math.cos(th), st = Math.sin(th);
      corners = local.map(([lx, ly]) => [lx * ct - ly * st, lx * st + ly * ct]);
      topZ = shapeRoofZ(segs, fh, h) || h;
    }
  }
  if (!corners) corners = [[-fh, -fh], [fh, -fh], [fh, fh], [-fh, fh]];   // footprint square (building-local)
  const sd = sun.shadowDir, off = clamp(topZ * sun.len, 0.15, 3.5);
  const ox = sd[0] * off, oy = sd[1] * off;   // where the roof lands on the ground, cast from the top
  const scr = [];
  for (const [cx, cy] of corners) { const p = cam.proj(dx + cx, dy + cy, 0); if (p.f <= 0.06) return; scr.push([p.sx, p.sy]); }
  for (const [cx, cy] of corners) { const p = cam.proj(dx + cx + ox, dy + cy + oy, 0); if (p.f <= 0.06) return; scr.push([p.sx, p.sy]); }
  const hull = convexHull2D(scr);
  ctx.fillStyle = `rgba(8,10,14,${clamp(sun.alpha * alpha, 0, 0.4)})`;
  ctx.beginPath(); ctx.moveTo(hull[0][0], hull[0][1]);
  for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i][0], hull[i][1]);
  ctx.closePath(); ctx.fill();
}

// Airframe shadow footprints in the craft's own GROUND frame — (fwd, side) in tile units,
// nose at +fwd. These are laid flat on the ground plane (z=0) and each vertex is projected
// through the camera, so the shadow genuinely skews and foreshortens with the Mode-7
// perspective instead of being a squashed 2D sprite pasted at a point.
const SHADOW_PLANE = [
  [[1.0, 0], [0.55, 0.11], [-0.85, 0.10], [-1.0, 0], [-0.85, -0.10], [0.55, -0.11]],   // fuselage
  [[0.22, 0.06], [-0.02, 0.95], [-0.24, 0.95], [-0.16, 0.06], [-0.16, -0.06], [-0.24, -0.95], [-0.02, -0.95], [0.22, -0.06]],   // swept wings
  [[-0.72, 0.34], [-1.0, 0.34], [-1.0, -0.34], [-0.72, -0.34]],   // tailplane
];

// The shadow silhouette's world size, PER CLASS — tied to the same CONTACT_SIZE knob that scales
// the drawn model (× OWN_EXT_MUL in draw), normalised so the reference 'prop' keeps its tuned 0.42.
// Before this the shadow was a flat 0.42 for every craft, so once the airframes were scaled a tiny
// heli cast a heavy's shadow (and vice-versa); now the footprint tracks the silhouette it belongs to.
const SHADOW_REF = CONTACT_SIZE.prop || 0.11;
function shadowScale(cls) { return 0.42 * (CONTACT_SIZE[cls] || SHADOW_REF) / SHADOW_REF; }

// Paint the shadow silhouette on the ground plane, centred at world ground point (gx,gy),
// nose along heading `hr` (radians), scaled by `L` tiles. Each vertex is projected through
// the camera so the shape lies flat on the surface and skews correctly with perspective.
// Shared by the sun-cast shadow and the grounded contact shadow.
// `soft` (0..1) blurs the edges into a penumbra: 0 = a crisp planted contact shadow, →1 =
// the diffuse smear a craft casts from altitude. The blur radius tracks the shadow's on-screen
// size (via cam.FL / forward-distance) so a near shadow softens more px than a far one and the
// look holds across the whole depth range.
function paintShadowSilhouette(ctx, cam, gx, gy, hr, L, alpha, cls, soft = 0) {
  const cs = Math.cos(hr), sn = Math.sin(hr);
  // craft-local (fwd,side) → world ground (z=0) → screen. forward = (sin,-cos), right = (cos,sin).
  const S = (fwd, side) => cam.proj(gx + fwd * sn + side * cs, gy - fwd * cs + side * sn, 0);
  const fillPoly = (localPts) => {
    const pts = [];
    for (const [f, s] of localPts) { const q = S(f * L, s * L); if (q.f <= 0.1) return; pts.push(q); }   // any vertex behind the lens → skip this poly
    ctx.beginPath(); ctx.moveTo(pts[0].sx, pts[0].sy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].sx, pts[i].sy);
    ctx.closePath(); ctx.fill();
  };
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgb(6,8,12)';
  if (soft > 0.01) {
    const c = cam.proj(gx, gy, 0);
    const pxPerTile = c.f > 0.1 ? cam.FL / c.f : 40;   // screen px per world tile at the shadow's distance
    const blurPx = clamp(pxPerTile * L * soft * 0.55, 0.6, 30);
    ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
  }
  if (cls === 'heli') {   // rotor disc + a stubby body
    const disc = [], body = [[0.62, 0], [0.1, 0.16], [-0.7, 0.12], [-0.7, -0.12], [0.1, -0.16]];
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; disc.push([Math.cos(a) * 0.95, Math.sin(a) * 0.95]); }
    fillPoly(disc); fillPoly(body);
  } else {
    for (const poly of SHADOW_PLANE) fillPoly(poly);
  }
  ctx.restore();
}

// The aircraft's own shadow on the ground — the airframe projected down onto the surface at
// the point the sun casts it. It slides away, shrinks, fades AND softens with altitude, so the
// growing gap + growing blur read together as a height gauge. Rather than clamping the reach and
// hard-culling past the draw distance (which snapped the shadow under the nose and then blinked
// it out on climb-out), the true cast point runs free and the shadow soft-FADES over the last
// few tiles before the far plane — a low-sun cast point dissolves toward the horizon instead.
function drawAircraftShadow(ctx, cam, height, sun, worldBlend, heading, cls) {
  const sd = sun.shadowDir, alt = clamp(height, 0, 1);
  // Physical-ish sun cast: offset ≈ altitude / tan(elevation), toward the anti-sun direction.
  // There's room to let it run — the ground draws to VISIBLE_FAR_F (34 tiles), far past the old
  // 3.2-tile clamp — so the shadow genuinely trails the craft as it climbs.
  const reach = alt * 10 / Math.max(0.35, sun.elev);
  const cxw = sd[0] * reach, cyw = sd[1] * reach;
  const p = cam.proj(cxw, cyw, 0);
  if (p.f <= 0.12) return;
  const farFade = clamp((VISIBLE_FAR_F - p.f) / 8, 0, 1);   // dissolve over the last 8 tiles, no hard cull
  if (farFade <= 0.01) return;
  const hr = (heading || 0) * Math.PI / 180;
  const soft = clamp(0.15 + alt * 0.85, 0, 1);   // crisp near the deck → diffuse smear up high
  paintShadowSilhouette(ctx, cam, cxw, cyw, hr, shadowScale(cls) * (1 - alt * 0.4),
    clamp(sun.alpha * 1.5 * worldBlend * (1 - alt * 0.5) * farFade, 0, 0.4), cls, soft);
}

// A soft contact shadow directly beneath the craft, present whenever it's on the ground
// (sun-independent — so it reads as planted even overcast or at night). Fades out over the
// first sliver of climb, handing off to the sun-cast shadow above once airborne.
function drawGroundContactShadow(ctx, cam, heading, cls, strength) {
  const p = cam.proj(0, 0, 0);
  if (p.f <= 0.12 || p.f > VISIBLE_FAR_F) return;
  const hr = (heading || 0) * Math.PI / 180;
  // Alpha rides on `strength` only (NOT worldBlend, which is 0 on the deck — that zeroed the
  // shadow exactly when the craft is parked and it should read most solid).
  paintShadowSilhouette(ctx, cam, 0, 0, hr, shadowScale(cls), clamp(0.36 * strength, 0, 0.36), cls, 0.14);
}

const HOLO_COLS = ['90,200,255', '255,90,160', '120,255,140', '255,200,80', '180,120,255'];
// A rooftop holographic advertising panel: a translucent coloured pane floating above the
// roof with scanline bars, stuttering and dropping frames (half its pixels dead).
function drawHoloAd(ctx, cam, dx, dy, fh, h, seed, now, alpha) {
  const col = HOLO_COLS[seed % HOLO_COLS.length];
  const z0 = h * 1.03, z1 = h * (1.28 + frac(seed) * 0.18), w = fh * (0.5 + frac(seed + 1) * 0.4);   // width kept ≤ fh (≤0.9·fh) so the ad never overhangs its own tile into the street (was up to 1.2·fh)
  const b0 = cam.proj(dx - w, dy, z0), b1 = cam.proj(dx + w, dy, z0), t1 = cam.proj(dx + w, dy, z1), t0 = cam.proj(dx - w, dy, z1);
  if ([b0, b1, t1, t0].some((p) => p.f <= 0.12)) return;
  const dropped = frac(Math.floor(now * 0.018) + seed) < 0.16;   // some frames blink out entirely
  const flick = (0.45 + 0.55 * Math.abs(Math.sin(now * 0.006 + seed))) * (dropped ? 0.15 : 1);
  emitFace(decoDepth(b0.f, b1.f, t1.f, t0.f), () => {
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
  });
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

// `precipLocal` (optional) overrides the global wx with the precipitation actually falling at the
// aircraft, sampled from the moving weather cells: { type, rate } where rate 0..1 scales density.
function drawWeather(ctx, W, H, wx, st, dt, speed, precipLocal) {
  // Resolve the precip to render: the local cell's if present, else the global weather string.
  let rainy = wx === 'rain' || wx === 'storm', snowy = wx === 'snow', stormy = wx === 'storm', rate = 1;
  if (precipLocal) {
    const t = precipLocal.type;
    snowy = t === 'snow' || t === 'blizzard' || t === 'sleet';
    rainy = !snowy && (t === 'rain' || t === 'storm' || t === 'thunderstorm' || t === 'acid' || t === 'drizzle');
    stormy = t === 'storm' || t === 'thunderstorm';
    rate = clamp(precipLocal.rate, 0.15, 1);
  }
  if (rainy) {
    const n = Math.round((stormy ? 90 : 55) * rate), slant = stormy ? 6 : 3;
    ctx.strokeStyle = `rgba(180,205,235,${(stormy ? 0.4 : 0.28) * (0.5 + rate * 0.5)})`; ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const p = st.parts[i]; p.y = (p.y + (0.9 + p.v) * dt * (1.4 + speed)) % 1; p.x = (p.x + 0.02 * dt) % 1;
      const x = p.x * W, y = p.y * H, len = 10 + p.v * 12;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - slant, y + len); ctx.stroke();
    }
    if (stormy && !precipLocal && Math.abs(Math.sin(st.scroll * 40)) > 0.985) { ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(0, 0, W, H); }
  } else if (snowy) {
    ctx.fillStyle = `rgba(240,246,255,${0.8 * (0.5 + rate * 0.5)})`;
    for (let i = 0; i < Math.round(60 * rate); i++) { const p = st.parts[i]; p.y = (p.y + (0.18 + p.v * 0.12) * dt) % 1; const x = (p.x + Math.sin(st.scroll * 3 + i) * 0.02) * W, y = p.y * H; ctx.beginPath(); ctx.arc(x, y, 1 + p.v, 0, 7); ctx.fill(); }
  } else if (wx === 'ash' || wx === 'dust') {
    ctx.fillStyle = 'rgba(200,140,90,0.5)';
    for (let i = 0; i < 60; i++) { const p = st.parts[i]; p.y = (p.y + (0.2 + p.v * 0.1) * dt) % 1; p.x = (p.x + 0.06 * dt) % 1; ctx.fillRect(p.x * W, p.y * H, 1.6, 1.6); }
  }
}

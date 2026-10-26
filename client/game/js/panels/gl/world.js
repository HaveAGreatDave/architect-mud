import { drawSky } from './sky.js';
// GLASS 2: the city's solid geometry in WebGL2, into a buffer the 2-D frame blits; lights, signage
// and the HUD still paint over it. `MASS_OFF` is the seam (an arm drawn with lights, no mass).
// ⚠ The mesh is cached on the map window's contents and rebuilt only when that changes. A per-frame
// rebuild draws the same picture, so check `glLastFrame().builds` (1 over a turning camera).
import { createGLView, MAX_LIGHTS } from './context.js';
import { buildAtlas, faceUVs } from './atlas.js';
import { lightMatrix, eyePos, nearFor, viewProjMatrix, setJitter } from './camera.js';
import { strokeRuns } from './propshadow.js';
import { jitterFor, reprojMatrix, TAA_TUNE } from './taa.js';
import { createSkylineStrip } from './skyline.js';
import { FOG_H_SCALE } from './fog.js';
import { SHADOW_BIAS_TILES } from './shadow.js';
import { venueState, venueEpoch, serviceNear } from '../world-feed.js';
import { roofsABerth } from '../glass/model-registry.js';

const scenes = new Map();

// ⚠ Release with `loseContext()`: it frees everything the scene owns in one call, and the browser
// caps live contexts (16) and force-loses the oldest, usually the live seat.
// See docs/reference/glass-notes.md#releasing-gl-scenes-2026-09-17
function releaseScene(g) {
  if (!g) return;
  if (g.canvas) {
    try { g.canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext(); }
    catch { /* no context on it, or it is already gone */ }
    // Drops the drawing buffer as well, which the lose above doesn't reach.
    try { g.canvas.width = 0; g.canvas.height = 0; } catch { /* detached */ }
  }
  g.view = null; g.canvas = null; g.atlas = null;
}

// Reached from `disposeWindshield` through installGLDispose; windshield.js mustn't import gl/.
export function glDisposeScene(id) {
  const g = scenes.get(id);
  if (!g) return false;
  scenes.delete(id);
  releaseScene(g);
  return true;
}

// ⚠ A cap so a missed dispose costs a rebuild, not another seat's context. The game holds at most
// four seats; the browser's ceiling is 16.
const MAX_SCENES = 8;
let warnedEvict = false;
// ⚠ Evict least-recently-painted, never by Map order: the first-inserted scene is the live seat.
function pruneScenes() {
  while (scenes.size >= MAX_SCENES) {
    let oldest = null, at = Infinity;
    for (const [k, s] of scenes) if ((s.usedAt || 0) < at) { at = s.usedAt || 0; oldest = k; }
    if (oldest == null) return;
    const g = scenes.get(oldest);
    scenes.delete(oldest);
    releaseScene(g);
    if (!warnedEvict) {
      warnedEvict = true;
      console.warn(`[glass2] evicted the least-recently-painted GL scene '${oldest}' — more than ${MAX_SCENES} were live at once, which means a view was opened whose teardown never reached glDisposeScene`);
    }
  }
}

// Vertex buffer rebuilds since page load, reported as `glLastFrame().builds`.
let builds = 0;

// ── POINT LIGHTS ON WALLS ───────────────────────────────────────────────────
// Lights come from 'SPRITE_SINK'. See docs/reference/glass-notes.md#point-lights-on-walls and
// #reach-2026-09-17 for the tuning behind these numbers.
// ⚠ Never rank on alpha: 'blinkLight' pulses it, and a blinking beacon re-lit every wall at once.
// ⚠ The mass is in map-window tiles and sprites are camera-relative: p_window = p_camera + (ox, oy).
// ⚠ Don't shrink 'minR'/'span': 'r' is also the wet road's streak length (ground.js, floor.js).
export const LIGHT_TUNE = {
  // Lit decals (tarps, sheets): strength, and share of the road's reach. 0 is off.
  cloth: 1.6, clothR: 0.55,
  minR: 0.8, span: 3.2,  // reach in tiles; the wet road was swept at these
  wallR: 0.32,   // share of the reach the wall's bloom takes (about a tile)
  washR: 0.99,   // share an area source keeps
  focus: 3.0,    // falloff exponent over the bloom
  // ⚠ Wall wash is off at 0; use this, not `RENDER_TUNE.glLights` 0, which also kills road and mirror
  // reflections. 0.18 is the last shipped value. See docs/reference/glass-notes.md#wall-wash-switched-off
  gain: 0,
  // ⚠ Moves with `gain`: washK × gain is the facade glow's 0.18. Parked while gain is 0.
  washK: 0.072,
  wet: 0.45, wrap: 0.35, rise: 0.22, fall: 0.38,
  // Lamps lift the night dim near a light, never past the daytime tone (context.js 'lamp'). 0 is off.
  // ⚠ liftR 0.8 gave a lantern a 2.7-tile lift and lit whole blocks; 0.4 keeps it near the light.
  lift: 1.6, liftR: 0.4,
  // A sign's light on its own wall (context.js grid loop); needs glCluster 1. 0 is off.
  // ⚠ signR at most liftR, or the grid cuts the reach at a cell edge (scripts/shapes/glcluster.mjs).
  sign: 0, signR: 0.35,
  // Which sprites light the road and walls. 1: street lamps (tag 'streetlamp', lit white) and bright
  // saturated neon only; windows, beacons and fittings glow but light nothing. 0 is every sprite.
  srcGate: 1, neonSat: 0.55, neonMax: 180,
};

// Contact occlusion falloff, exp(-z * fall) in inverse tiles. Strength (and off) is `RENDER_TUNE.glAO`.
const AO_TUNE = { fall: 1.6 };

// A challenger must beat a held light by this factor, or near-equal lights swap as the camera creeps.
const LIGHT_HOLD = 1.35;
// ⚠ Slots held for surface washes, as a share so it scales with the slot count. See the splice
// at the end of pickLights.
const WASH_SHARE = 1 / 6;
const washSlots = (slots) => Math.max(1, Math.round(slots * WASH_SHARE));
// Road reflection slots held for washes: the ground shader takes the first `MAX_WET` and washes sort
// last, so without this a wash never reflects in its own puddle.
const ROAD_WASH_SLOTS = 2;
const ROAD_LIGHTS = 6;                 // ⚠ must equal `MAX_WET` in ground.js
function roadLights(list) {
  if (!list || list.length <= ROAD_LIGHTS) return list;
  const wash = [], src = [];
  for (const L of list) (L.wash ? wash : src).push(L);
  if (!wash.length) return list;
  const take = Math.min(ROAD_WASH_SLOTS, wash.length);
  return wash.slice(0, take).concat(src.slice(0, ROAD_LIGHTS - take));
}

// ⚠ A light fades in and out of its slot, never switches: a swap otherwise pops a whole wall wash.
// The ramp is in seconds and dt is clamped. See docs/reference/glass-notes.md#light-slot-fades
const LIGHT_DT_MAX = 0.1;  // clamp on one frame's delta
// Share of slots an outgoing light may borrow while it fades.
const FADE_SHARE = 1 / 4;
const fadeSlots = (slots) => Math.max(1, Math.round(slots * FADE_SHARE));

// ⚠ 'slots' defaults to the ceiling: 'slice(0, undefined)' is empty and fadeLights returned null.
// ⚠ The list is built by day too (a wet road reflects neon in a downpour); only 'rgb', the wall
// wash, is night-weighted. 'rgbRaw' keeps 'wet' for reflecting surfaces; 'lamp' is night-weighted
// without the wash gain, for walls, actors and solids.
// ⚠ Rank on distance from the eye, never view depth, or a turn alone churns the slots
// (see docs/reference/glass-notes.md#light-slot-fades; 'npm run gl:fade').
// ⚠ Light in flight ('s.air') isn't a source: it steals slots and has a new 'key' every frame.
// 'key' is the quantised position, since sprites have no identity between frames.
// Washes get held slots (WASH_SHARE): in one ranking a wash bright enough to win evicts the neon.
// The splice drops the weakest sources, never a wash, and leaves a washless frame unchanged.
// Ranking uses reused parallel arrays; full entries are built only for the top 'slots', swapped-in
// washes and anything 'keep' names. The rest are '{ key, score }' stubs.
const WHITE_RGB = [255, 255, 255];
const PL = { s: [], r: [], key: [], score: [], idx: [] };
export function pickLights(cam, sprites, night, held, slots = MAX_LIGHTS, keep = null) {
  if (!sprites || !sprites.length || !cam) return null;
  const nightK = Math.min(1, Math.max(0, night));
  const nightGain = LIGHT_TUNE.gain * nightK;
  const { sinh, cosh, back, fx = 0, fy = 0 } = cam;
  const tx = back * sinh - fx, ty = -back * cosh - fy;
  const ox = cam.ox || 0, oy = cam.oy || 0;
  const eh = cam.EH || 0;
  const tanH = cam.FL > 0 && cam.W > 0 ? cam.W / 2 / cam.FL : 0;
  let n = 0;
  for (const s of sprites) {
    if (!(s.a > 0.02)) continue;
    if (s.air) continue;
    const bx = s.x + tx, by = s.y + ty;
    const f = bx * sinh - by * cosh;
    if (!(f > 0.2)) continue;             // behind the eye, or on it
    let c = s.rgb || WHITE_RGB;
    if (LIGHT_TUNE.srcGate) {
      if (s.tag === 'streetlamp') c = WHITE_RGB;
      else {
        const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
        if (mx < LIGHT_TUNE.neonMax || (mx - mn) / mx < LIGHT_TUNE.neonSat) continue;
      }
    }
    const I = Math.min(1, (c[0] * 0.3 + c[1] * 0.6 + c[2] * 0.1) / 255);
    const r = LIGHT_TUNE.minR + LIGHT_TUNE.span * Math.sqrt(I);
    if (tanH > 0 && Math.abs(bx * cosh + by * sinh) > (f + r) * tanH * 1.3 + r) continue;
    const d = Math.max(0.2, Math.hypot(bx, by, s.z - eh));
    const key = ((s.x * 8) | 0) * 1048576 + ((s.y * 8) | 0) * 1024 + ((s.z * 8) | 0);
    PL.s[n] = s; PL.r[n] = r; PL.key[n] = key;
    PL.score[n] = held && held.has(key) ? I * r / d * LIGHT_HOLD : I * r / d;
    n++;
  }
  if (!n) return null;
  PL.s.length = n;   // drop sprite references past this frame's count
  const idx = PL.idx;
  idx.length = n;
  for (let i = 0; i < n; i++) idx[i] = i;
  const sc = PL.score;
  idx.sort((p, q) => sc[q] - sc[p]);
  const make = (i) => {
    const s = PL.s[i], r = PL.r[i], isWash = !!s.wash;
    const c = LIGHT_TUNE.srcGate && s.tag === 'streetlamp' ? WHITE_RGB : s.rgb || WHITE_RGB;
    const k = s.a * nightGain * (isWash ? LIGHT_TUNE.washK : 1);
    return {
      p: [s.x + ox, s.y + oy, s.z],
      rgb: [c[0] / 255 * k, c[1] / 255 * k, c[2] / 255 * k],
      rgbRaw: [c[0] / 255 * s.a * LIGHT_TUNE.wet, c[1] / 255 * s.a * LIGHT_TUNE.wet, c[2] / 255 * s.a * LIGHT_TUNE.wet],
      r,
      rw: r * (isWash ? LIGHT_TUNE.washR : LIGHT_TUNE.wallR),
      rl: r * LIGHT_TUNE.liftR,
      // The sign's own reach on its wall; none for an area wash.
      sr: isWash ? 0 : r * Math.min(LIGHT_TUNE.signR, LIGHT_TUNE.liftR),
      lamp: [c[0] / 255 * s.a * nightK, c[1] / 255 * s.a * nightK, c[2] / 255 * s.a * nightK],
      key: PL.key[i],
      wash: isWash,
      score: sc[i],
    };
  };
  const tail = (from) => {
    const out = [];
    for (let j = from; j < n; j++) {
      const i = idx[j];
      out.push(!keep || keep.has(PL.key[i]) ? make(i) : { key: PL.key[i], score: sc[i] });
    }
    return out;
  };
  const top = [];
  for (let j = 0; j < Math.min(slots, n); j++) top.push(make(idx[j]));
  // The whole list, every entry full, for the light grid (gl/lightgrid.js). Built only when read;
  // read it the same frame, since PL is reused. The wash splice never reorders it.
  const withAll = (res) => Object.defineProperty(res, 'all', { get: () => { const a = new Array(n); for (let j = 0; j < n; j++) a[j] = make(idx[j]); return a; } });
  const WASH = washSlots(slots);
  if (WASH > 0 && n > slots) {
    let have = 0;
    for (const e of top) if (e.wash) have++;
    if (have < WASH) {
      const want = [];
      for (let j = slots; j < n && want.length < WASH - have; j++) if (PL.s[idx[j]].wash) want.push(j);
      const rest = tail(slots);
      for (let i = top.length - 1, k = 0; i >= 0 && k < want.length; i--) {
        if (top[i].wash) continue;
        const j = want[k++], e = rest[j - slots];
        top[i] = e.p ? e : make(idx[j]);
      }
      return withAll(top.concat(rest));
    }
  }
  return withAll(n > slots ? top.concat(tail(slots)) : top);
}

// Ramp each light toward its target and return the slots, weighted. `state` is per scene.
export function fadeLights(ranked, state, dt, slots = MAX_LIGHTS) {
  // ⚠ The set is chosen on score alone; weight only sets brightness. Ranking on score * weight makes
  // a newly elected light (weight 0) lose its slot back, and churns worse than no fade.
  const rise = LIGHT_TUNE.rise > 0 ? dt / LIGHT_TUNE.rise : 1;
  const fall = LIGHT_TUNE.fall > 0 ? dt / LIGHT_TUNE.fall : 1;
  // ⚠ A fading light needs a free slot, so the wanted set gives up one per outgoing light (up to
  // fadeSlots), lowest score first; the bumped light then fades out in turn.
  const ideal = ranked.slice(0, slots);
  const idealKeys = new Set(ideal.map((e) => e.key));
  const fading = ranked.filter((e) => !idealKeys.has(e.key) && (state.get(e.key) ?? 0) > 0);
  const reserve = Math.min(fading.length, fadeSlots(slots));
  const wanted = ideal.slice(0, Math.max(1, slots - reserve));
  const inSet = new Set(wanted.map((e) => e.key));
  const live = [];
  for (const e of wanted) {
    const w = Math.min(1, (state.get(e.key) ?? 0) + rise);
    state.set(e.key, w);
    if (w > 0) live.push({ e, w });
  }
  for (const e of ranked) {
    if (inSet.has(e.key)) continue;
    const w0 = state.get(e.key);
    if (w0 === undefined) continue;
    const w = w0 - fall;
    if (w <= 0) { state.delete(e.key); continue; }
    state.set(e.key, w);
    if (live.length < slots) live.push({ e, w });
  }
  // ⚠ A light that left the frame isn't in `ranked`; decay it here or it keeps a stale weight.
  const seen = new Set(ranked.map((e) => e.key));
  for (const [k, w0] of [...state]) {
    if (seen.has(k)) continue;                 // handled above, in one of the two loops
    const w = w0 - fall;
    if (w <= 0) state.delete(k); else state.set(k, w);
  }
  if (!live.length) return null;
  return live.map(({ e, w }) => ({ ...e, rgb: [e.rgb[0] * w, e.rgb[1] * w, e.rgb[2] * w] }));
}

// ⚠ THE FRAME IS HANDED OVER, NOT COPIED (RENDER_TUNE.glTransfer). The sky, the world, the cloud deck
// and the cabin all go through this one canvas, and the 2-D canvas copies each out with drawImage.
// A copy that hasn't been rasterised yet still holds the drawing buffer, so the next pass to write
// into it made Chrome keep the old contents, and the copy after that paid: ~0.9 ms at 1280x720 for
// the cabin, which is drawn after the world was copied out and the 2-D glass and rain went over it
// (docs/proposals/glass-headroom.md, "the cabin's copy"). With the switch on the canvas is an
// OffscreenCanvas and each pass hands back `transferToImageBitmap()`: the bitmap owns that buffer and
// the next pass draws into a fresh one, so there is nothing to keep. The caller draws the bitmap and
// closes it. ⚠ A FRESH BUFFER HAS A FRESH DEPTH BUFFER TOO, so the world is handed over only when its
// depth is in the float target (HDR live), which is where the cloud deck goes back for it.
// ⚠ AND `glLastFrame().canvas` IS BLANK AFTER A HAND-OVER: a bench that reads it back sets the switch to 0.
const newGLCanvas = (off, w, h) => {
  if (off) return new OffscreenCanvas(Math.max(1, w | 0), Math.max(1, h | 0));
  const cv = document.createElement('canvas');
  cv.className = 'ws-gl';
  return cv;
};
// The bitmap a pass hands over, or null for the canvas itself (switch off, or no OffscreenCanvas).
const blitOf = (g) => (g.off ? g.canvas.transferToImageBitmap() : null);
// ⚠ ASKED ONCE, BY MAKING ONE: a browser can have OffscreenCanvas and no WebGL2 in it, and a view
// that fails to build takes the whole frame back to the 2-D renderer for good.
let OFF_GL = null;
function offscreenGL() {
  if (OFF_GL !== null) return OFF_GL;
  OFF_GL = false;
  // ⚠ A REAL WebGL2RenderingContext, NOT ANY TRUTHY ANSWER: the headless DOM stub
  // (scripts/shapes/dom-stub.mjs) has an OffscreenCanvas that hands back a 2-D stub for every type,
  // and taking that for WebGL2 sent every headless GL bench back to the 2-D renderer.
  try {
    const c = new OffscreenCanvas(1, 1), g = c.getContext('webgl2');
    OFF_GL = typeof WebGL2RenderingContext === 'function' && g instanceof WebGL2RenderingContext
      && typeof c.transferToImageBitmap === 'function' && typeof c.addEventListener === 'function';
    if (OFF_GL) g.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* no OffscreenCanvas WebGL2: the plain canvas */ }
  return OFF_GL;
}

function sceneGL(id, w, h, msaa = 1, transfer = false) {
  let g = scenes.get(id);
  // ⚠ Prune before inserting, so no more than MAX_SCENES contexts are ever live.
  if (!g) { pruneScenes(); g = { canvas: null, view: null, key: '', atlasKey: '', epoch: '', atlas: null, msaa: msaa !== 0 ? 1 : 0 }; scenes.set(id, g); }
  // Stamped every call: a steady seat paints constantly and rebuilds almost never.
  g.usedAt = Date.now();
  const wantOff = transfer && typeof OffscreenCanvas === 'function' && offscreenGL() ? 1 : 0;
  // ⚠ The GL canvas never joins the page: under the 2-D canvas it's painted over, on top it covers
  // the lights. The caller blits it in at the mass's place in the frame.
  if (!g.canvas) { g.canvas = newGLCanvas(wantOff, w, h); g.off = wantOff; }
  // ⚠ Never rebuild the view on resize: a resize keeps the context and its objects, while a rebuild
  // leaks them, and the resolution dial resizes often enough to get the context force-lost.
  //
  // ⚠ MSAA can't change on a live context (`antialias` is a creation attribute), so it needs a new
  // canvas, and the old context is lost explicitly. So does switching to or from an OffscreenCanvas.
  const wantMsaa = msaa !== 0 ? 1 : 0;
  if (g.view && (g.msaa !== wantMsaa || (g.off || 0) !== wantOff)) {
    try { g.canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* nothing to lose */ }
    g.canvas = newGLCanvas(wantOff, w, h); g.off = wantOff;
    g.view = null; g.key = ''; g.atlasKey = '';
  }
  g.msaa = wantMsaa;
  if (g.canvas.width !== w || g.canvas.height !== h) { g.canvas.width = w; g.canvas.height = h; }
  if (!g.view) { g.view = createGLView(g.canvas, { msaa: wantMsaa }); g.atlasKey = ''; g.key = ''; }
  return g;
}

// ⚠ windowKeyOf sorts its parts: cells arrive far-to-near, so an unsorted key rebuilds the mesh on
// every turn with no visible sign.
//
// A wall with its feed down needs its own bake (the texture carries the lit window grid).
// ⚠ Roofs and `win == null` never vary, which keeps the atlas unchanged with the lights on.
// ⚠ The separator must not appear in a palette key.
const TEX_WIN_SEP = '|';
// Marks the bare bake of a facade palette (no window grid), on the palette part of the key.
const TEX_BARE = '~';
function texVariant(key, win) {
  return (win == null || key.charCodeAt(0) === 114 /* 'r' — a roof */) ? key : key + TEX_WIN_SEP + win;
}

// The key per cells array: windshield.js hands the same array until the window changes
// (GL_CELL_CACHE, never mutated), so this runs once per window and once per venue push.
const WINDOW_KEYS = new WeakMap();
const MASS_REANCHOR = 48;   // tiles the window may move from the kept mass's anchor before a full build (massKeep)
// `world` keys a tile on its world tile rather than its place in the window (RENDER_TUNE.massKeep),
// so a recentre that brings no building in or out keeps the key and the buffer.
function windowKey(cells, world = false) {
  const ep = venueEpoch();
  let k = WINDOW_KEYS.get(cells);
  if (k === undefined || k.ep !== ep || k.world !== world) WINDOW_KEYS.set(cells, k = { key: windowKeyOf(cells, world), ep, world });
  return k.key;
}
// One tile's part of the key, which with `world` is also its group's key in the kept buffer.
const tileKeyOf = (it, world) => (world ? it.wx + ',' + it.wy : it.gx + ',' + it.gy) + ':' + (it.c.bt || '') + ':' + (it.c.bn || '') + ':' + meshParams(it)
  + ':' + (it.c.pw == null ? '' : it.c.pw) + (it.c.em ? 'e' : '') + (it.c.og ? 'o' : '');
function windowKeyOf(cells, world = false) {
  // bt/bn say which model; meshParams says what it was built as. Both are needed.
  // ⚠ The grid state (pw) is in here so a blackout reaches the vertex buffer now, not at the next corner.
  const parts = cells.map((it) => tileKeyOf(it, world));
  parts.sort();
  return parts.join(';');
}

// Captured meshes, cached per model: `captureModelMesh` runs the arm, and a rebuild must only walk
// faces. The camera is never in the key.
// ⚠ Keyed on the model object's identity: the Modelshop makes a new record per edit.
const meshCache = new WeakMap();
// Everything a tile's mesh is built from, shared by the mesh cache and 'windowKey'.
// ⚠ Seed matters: many models are seed-variant and seed feeds 'fh'; left out, buildings changed
// size at random in flight.
// __glChurnStart(), fly, __glChurn() lists any building built more than one way. It keys on the
// building's name, so it's only exact on the real map. Free when off.
let CHURN = null;
if (typeof window !== 'undefined') {
  window.__glChurnStart = () => { CHURN = new Map(); return String.fromCharCode(114) + "ecording — fly for a bit, then call __glChurn()"; };
  window.__glChurn = () => {
    if (!CHURN) return "not recording — call __glChurnStart() first";
    const rows = [];
    for (const [name, set] of CHURN) if (set.size > 1) rows.push({ building: name, builtAs: set.size, saw: [...set] });
    rows.sort((a, b) => b.builtAs - a.builtAs);
    const seen = CHURN.size; CHURN = null;
    const note = "each row is one building that was built more than one way; in the real world a"
      + " name is one tile, so anything above 1 is the bug. On a generated map repeats are normal.";
    return rows.length ? { changed: rows.length, of: seen, note, rows }
      : { changed: 0, of: seen, note: "no building changed its footprint, height, seed or facing" };
  };
}
// ⚠ No RENDER_TUNE flag is in this key, so a flag that changes a mesh needs a reload (set it before
// the first paint). The district is in it because the detail kit varies by district (`_place`).
const meshParams = (it) => it.fh + ':' + it.h + ':' + it.seed + ':' + it.E[0] + ',' + it.E[1]
  + ':' + (it.c && it.c.biome || '') + ':' + (it.wx | 0) + venueKey(it) + serviceKey(it);
// ⚠ A building that roofs a berth is a second mesh while a service bay is open beside it: the
// roof is off (world-feed.js `noteServiceAt`). Only those types, so opening a truck bay doesn't
// recapture the buildings round the shed.
const serviceOpenAt = (it) => !!(it.c && roofsABerth(it.c.bt) && serviceNear(it.wx, it.wy));
const serviceKey = (it) => (serviceOpenAt(it) ? ':svc' : '');
// ⚠ A venue is a different mesh per state (lit, roof shut/open/moving). Read it through
// `venueState`, as the capture does via `placeOf`, or the key and mesh disagree after a push.
const isVenue = (c) => !!c && (c.vl != null || c.vr != null);
function venueKey(it) {
  if (!isVenue(it.c)) return '';
  const s = venueState(it.wx, it.wy, it.c);
  return (s.vl ? ':v' : '') + (s.vr == null ? '' : ':r' + s.vr + (s.vrm ? 'm' : ''));
}

// What the shadow pass gets, or null when the knob is off, nothing casts, or there's no geometry.
// ⚠ Null is a hard gate: the pass is a full re-render, and len 0 makes the ortho box degenerate.
// The moon casts too (`moonCast`), through the same len.
// ⚠ Use `castDir`, never `dir`: `dir` stays the sun for the glint, wall key and hillshade.
function sunShadowFor(g, opts) {
  const str = opts.glShadow || 0;
  const sun = opts.sun;
  if (!(str > 0) || !sun || !(sun.len > 0) || !(sun.castDir || sun.dir)) return null;
  const b = g.view.bounds;
  if (!b) return null;
  // ⚠ The bias is converted from tiles into this box's own depth range: the box fits the mesh, so a
  // clip-unit constant is a different distance in each seat. Diagonal, since a low sun spans ground.
  const span = Math.max(1, Math.hypot(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0));
  // Toward the sun in 3-D, for the bias slope term only; `len` is cot(elevation) (see lightMatrix).
  const cd = sun.castDir || sun.dir;
  const sx = cd[0] * sun.len, sy = cd[1] * sun.len;
  const sl = Math.hypot(sx, sy, 1) || 1;
  return {
    str, lightVP: lightMatrix(sun, b), bias: SHADOW_BIAS_TILES / span,
    sunDir: [sx / sl, sy / sl, 1 / sl],
  };
}

// What the street-furniture map gets (gl/propshadow.js, RENDER_TUNE.glPropShadow), or null when off.
// The casters are the shed and park solids (`bay`), the people (`fauna`) and the plain strokes: lamp
// posts, signal masts, wires. ⚠ Not the own ship: it lays its own contact shadow (OWN_SHADOWS), and
// would shade the road twice. `wall` is the mass map's own strength, so a post on a wall reads as a
// building on a wall; `ground` is as dark as a hull gets (drawBuildingShadow's sun.alpha, 0.4 at most).
function propShadowFor(cam, camAt, cssH, dpr, opts) {
  const k = opts.glPropShadow || 0;
  const sun = opts.sun;
  if (!(k > 0) || !sun || !(sun.len > 0) || !(sun.castDir || sun.dir) || !(sun.alpha > 0)) return null;
  const e = eyePos(camAt);
  return {
    sun, eye: e, fwd: [camAt.sinh || 0, -(camAt.cosh == null ? 1 : camAt.cosh)],
    casters: {
      solids: [opts.bay, opts.fauna],
      strokes: cam.FL > 0 ? { runs: strokeRuns(opts.strokes, cam.ox || 0, cam.oy || 0), vp: viewProjMatrix(camAt, cssH), FL: cam.FL * (dpr || 1) } : null,
    },
    wall: Math.min(1, k * (opts.glShadow > 0 ? opts.glShadow : 0.55)),
    ground: Math.min(1, k * Math.min(0.4, sun.alpha)),
  };
}

// Baked per-vertex AO for concave geometry (recesses, sill undersides, inner corners), which the
// height term `RENDER_TUNE.glAO` can't see. Paid once per model inside the tileMesh memo.
// Samples a hemisphere against the same solid CFIT uses (`modelSolid`).
const AO_DIRS = (() => {
  // Fixed angles, never random: the bake must be deterministic for `models:diff`.
  const out = [[0, 0, 1]];
  for (const [tilt, n] of [[0.62, 4], [1.05, 4]]) {
    const st = Math.sin(tilt), ct = Math.cos(tilt);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (tilt > 1 ? Math.PI / 4 : 0);
      out.push([Math.cos(a) * st, Math.sin(a) * st, ct]);
    }
  }
  return out;
})();
// Two reaches in tiles (a wall is 0.88 across), so deep corners read darker than touching ones.
const AO_REACH = [0.05, 0.14];
// Sample start offset off the surface: trim stands proud by only `FACE_EPS`, and without this it bakes black.
const AO_BIAS = 0.006;

export function bakeFaceAO(faces, solid) {
  // A face whose box, grown by the reach, misses every segment box is open and needs no solid() call.
  // ⚠ Segment boxes are conservative (modelSolid); an under-sized one would bake a corner open.
  const REACH = AO_REACH[AO_REACH.length - 1] + AO_BIAS;
  // Samples test only the segments in range. ⚠ Never skip a face's own host: a face inside a larger
  // box really is occluded by it.
  // ⚠ `near` is null, never [], without bounds: an empty list means test nothing, baking all open.
  const near = solid.bounds ? [] : null;
  const bounds = solid.bounds || null;
  const anyNear = (f) => {
    if (!bounds) return true;          // no bounds: `near` is null and the full scan runs
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of f.p) {
      if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0];
      if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1];
      if (q[2] < z0) z0 = q[2]; if (q[2] > z1) z1 = q[2];
    }
    x0 -= REACH; x1 += REACH; y0 -= REACH; y1 += REACH; z0 -= REACH; z1 += REACH;
    near.length = 0;
    for (let i = 0; i < bounds.length; i++) {
      const b = bounds[i];
      if (b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1 && b.z1 >= z0 && b.z0 <= z1) near.push(i);
    }
    return near.length > 0;
  };
  for (const f of faces) {
    if (!anyNear(f)) { f.ao = null; continue; }   // fills `near` with the segments in range
    const n = f.n && (f.n[0] || f.n[1] || f.n[2]) ? f.n : [0, 0, 1];
    // ⚠ The seed axis must not be parallel to n, or every sample collapses to a uniform grey.
    const ax = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    let tx = [n[1] * ax[2] - n[2] * ax[1], n[2] * ax[0] - n[0] * ax[2], n[0] * ax[1] - n[1] * ax[0]];
    const tl = Math.hypot(tx[0], tx[1], tx[2]) || 1;
    tx = [tx[0] / tl, tx[1] / tl, tx[2] / tl];
    const ty = [n[1] * tx[2] - n[2] * tx[1], n[2] * tx[0] - n[0] * tx[2], n[0] * tx[1] - n[1] * tx[0]];
    const ao = new Float32Array(f.p.length);
    for (let v = 0; v < f.p.length; v++) {
      const q = f.p[v];
      let hits = 0, taken = 0;
      for (const d of AO_DIRS) {
        const wx = tx[0] * d[0] + ty[0] * d[1] + n[0] * d[2];
        const wy = tx[1] * d[0] + ty[1] * d[1] + n[1] * d[2];
        const wz = tx[2] * d[0] + ty[2] * d[1] + n[2] * d[2];
        for (let r = 0; r < AO_REACH.length; r++) {
          const R = AO_REACH[r];
          taken++;
          if (solid(q[0] + n[0] * AO_BIAS + wx * R, q[1] + n[1] * AO_BIAS + wy * R,
                    q[2] + n[2] * AO_BIAS + wz * R, near)) hits++;
        }
      }
      ao[v] = taken ? 1 - hits / taken : 1;
    }
    f.ao = ao;
  }
}

// Shading bevel as a distance field: normals tilt near a face's edges, no vertex moves, so CFIT,
// the occluder hull and shadows see nothing and the face budget ('gl:mesh') is untouched.
// ⚠ The field is exactly linear, so barycentric interpolation reproduces it; bilinear would crease.
// ⚠ The tangent frame must match the shader's exactly (they're commented as a pair).
// Returns [d(-T), d(+T), d(-B), d(+B)] per vertex, or null for a non-quad (null means no bevel).
export function faceEdges(face) {
  const p = face.p;
  if (!p || p.length !== 4) return null;
  const nn = face.n;
  const n = (nn && (nn[0] || nn[1] || nn[2])) ? nn : [0, 0, 1];
  const nl = Math.hypot(n[0], n[1], n[2]) || 1;
  const nx = n[0] / nl, ny = n[1] / nl, nz = n[2] / nl;
  // cross([0,0,1], n), normalised, with the shader's fallback for a horizontal face.
  let tx = -ny, ty = nx, tz = 0;
  const tl = Math.hypot(tx, ty, tz);
  if (tl > 0.001) { tx /= tl; ty /= tl; tz /= tl; } else { tx = 1; ty = 0; tz = 0; }
  // cross(n, T)
  const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
  const u = new Array(4), v = new Array(4);
  for (let i = 0; i < 4; i++) {
    const q = p[i];
    u[i] = q[0] * tx + q[1] * ty + q[2] * tz;
    v[i] = q[0] * bx + q[1] * by + q[2] * bz;
  }
  const u0 = Math.min(u[0], u[1], u[2], u[3]), u1 = Math.max(u[0], u[1], u[2], u[3]);
  const v0 = Math.min(v[0], v[1], v[2], v[3]), v1 = Math.max(v[0], v[1], v[2], v[3]);
  // ⚠ A degenerate quad gets no bevel: dividing by zero would hand the shader a NaN normal.
  if (!(u1 - u0 > 1e-6) || !(v1 - v0 > 1e-6)) return null;
  // ⚠ It must be a true rectangle: distances are to the bounding box, which matches the edges only
  // for a rectangle (a diagonal strut's box is far larger). Area equal to width times height rejects
  // everything else.
  let area = 0;
  for (let t = 1; t + 1 < 4; t++) {
    const a = p[0], b = p[t], c = p[t + 1];
    const ax2 = b[0] - a[0], ay2 = b[1] - a[1], az2 = b[2] - a[2];
    const bx2 = c[0] - a[0], by2 = c[1] - a[1], bz2 = c[2] - a[2];
    area += 0.5 * Math.hypot(ay2 * bz2 - az2 * by2, az2 * bx2 - ax2 * bz2, ax2 * by2 - ay2 * bx2);
  }
  const box = (u1 - u0) * (v1 - v0);
  if (!(Math.abs(box - area) <= box * 1e-4)) return null;
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    out[i * 4] = u[i] - u0;       // toward -T
    out[i * 4 + 1] = u1 - u[i];   // toward +T
    out[i * 4 + 2] = v[i] - v0;   // toward -B
    out[i * 4 + 3] = v1 - v[i];   // toward +B
  }
  return out;
}

// Normal lean across the chamfer. Not a knob: the width is the tuned size.
const BEVEL_TILT = 1.0;

// Bright-pass gain on additive sprites. Not a player knob (bloom strength is).
// ⚠ Keep at 1: scaling a soft glow pushes its whole shoulder past white into a flat disc, and from
// the air overlapping `drawCityBloom` halos became a haze. Measure from the air ('peak()', '__glHdr()').
const EMISSIVE_GAIN = 1;

// Added (not multiplied) past white on quads declared emissive (lit neon faces), so a full one ends
// at 1 + this. Safe here because sign strokes are hard-edged; kept apart from EMISSIVE_GAIN.
// ⚠ Past ~0.9 the lettering's white core blooms into its board and stops reading as words.
const SIGN_EMISSIVE_GAIN = 0.9;

const HDR_TUNE = {
  // Over one is emitting. Lower thresholds picked up road markings, not lights.
  threshold: 1.0,
  // Shoulder width, so a surface crossing the threshold doesn't pop into bloom between frames.
  knee: 0.4,
};

// Screen-space AO, in tiles (view space is metric).
// ⚠ Keep the radius small: it's for the gap between two buildings (a wall is 0.88 tiles). Larger
// turns into a grey vignette that follows the camera.
const SSAO_TUNE = {
  radius: 0.5,
  // Min depth in front, in tiles, before a sample occludes; stops a flat wall banding itself.
  bias: 0.02,
};

// ⚠ There's deliberately no per-vertex emission channel; it was built and moved nothing.
// See docs/reference/glass-notes.md#no-emission-channel

// The district a GL cell stands in, as `setTilePlace` wants it; shared by the day and night captures.
// ⚠ It carries a venue's game night and roof (`vl`, `vr`, `vrm`), or the mesh bakes an unlit,
// roofless park. `mesh` makes the arm draw the keyed state, not a moving roof's position.
const placeOf = (it) => {
  const p = { biome: it.c && it.c.biome, wx: it.wx, wy: it.wy, vl: it.c && it.c.vl };
  if (isVenue(it.c)) Object.assign(p, venueState(it.wx, it.wy, it.c), { mesh: 1 });
  // The service state the key names (windshield.js `berthServiceOpen` reads it during a capture).
  p.svc = serviceOpenAt(it) ? 1 : 0;
  return p;
};

// Per-cells-array cache of tileMesh lookups for the skyline strip, which reads them every frame.
const SKY_FACES = new WeakMap();
function skylineFaces(deps, cells) {
  let m = SKY_FACES.get(cells);
  if (!m) { m = new Map(); SKY_FACES.set(cells, m); }
  return (it) => { let f = m.get(it); if (f === undefined) m.set(it, f = tileMesh(deps, it)); return f; };
}
function tileMesh(deps, it) {
  let byParam = meshCache.get(it.m);
  if (!byParam) { byParam = new Map(); meshCache.set(it.m, byParam); }
  const k = meshParams(it);
  let faces = byParam.get(k);
  if (!faces) {
    let mesh;
    try { mesh = deps.captureModelMesh(it.m, { fh: it.fh, h: it.h, seed: it.seed, E: it.E, place: placeOf(it) }); } catch { mesh = []; }
    // A second capture at night, colour only: under GLASS 2 the mesh is the only source of trim
    // appearance, so without it lit bays and shopfronts stay at noon. Geometry matches face for face.
    // ⚠ Indexed, not matched: a face count that varies by hour would swap colours, so a length
    // mismatch drops it (and `gl:mesh` fails).
    let night = null;
    try { night = deps.captureModelMesh(it.m, { fh: it.fh, h: it.h, seed: it.seed, E: it.E, night: 1, place: placeOf(it) }); } catch { night = null; }
    if (night && night.length !== mesh.length) night = null;
    faces = mesh.map((f, i) => {
      const day = f.rgbOverride || deps.palette.get(f.pal) || [120, 126, 134];
      const nf = night && night[i];
      const nrgb = nf && (nf.rgbOverride || deps.palette.get(nf.pal) || null);
      // Only a face that changes carries a night colour (see `uploadGroups`).
      const nStore = nrgb && (nrgb[0] !== day[0] || nrgb[1] !== day[1] || nrgb[2] !== day[2]) ? nrgb : null;
      return {
        ...f,
        rgb: day,
        rgbN: nStore,
        uv: faceUVs(f),
        // Edge distances for the shading bevel, paid once per model.
        edge: faceEdges(f),
        // A wall the kit glazed for real samples its palette's bare bake (`markBareWalls`).
        texKey: f.pal ? (f.kind === 'roof' ? 'r:' : 'w:') + f.pal + (f.bare && f.kind !== 'roof' ? TEX_BARE : '') : null,
        // Material family, resolved per model like `texKey`.
        // ⚠ No palette takes 0 (the default facade), never out of range: an out-of-bounds uniform
        // read returns gloss 0 and a mirror-bright specular on all trim. A lit drum names its own (`matId`).
        mat: f.matId != null ? f.matId : f.pal
          ? (f.kind === 'roof'
            ? (deps.roofMaterialId ? deps.roofMaterialId(f.pal) : 0)
            : (deps.wallMaterialId ? deps.wallMaterialId(f.pal) : 0))
          : 0,
      };
    });
    // Height and wall colour for the skyline strip, in the memo since the strip rebuilds every frame.
    // ⚠ Walls only: pale gravel roofs would wash every reflected silhouette grey.
    {
      let r = 0, g2 = 0, b = 0, n = 0, top = -1e9;
      for (const f of faces) {
        for (const p of f.p) if (p[2] > top) top = p[2];
        if (f.kind !== 'wall' || !f.rgb) continue;
        r += f.rgb[0]; g2 += f.rgb[1]; b += f.rgb[2]; n++;
      }
      if (n) faces.avgRgb = [r / n, g2 / n, b / n];
      if (top > -1e8) faces.topZ = top;
    }
    // A model whose shape won't capture gets no AO term rather than a wrong one.
    try {
      const solid = deps.modelSolid && deps.modelSolid(it.m, it.seed, it.fh, it.h);
      if (solid) bakeFaceAO(faces, solid);
    } catch { /* an un-captured shape is not a claim about occlusion */ }
    byParam.set(k, faces);
  }
  return faces;
}

// `cells` is [{ gx, gy, c, m, fh, h, seed, E }], resolved by drawWorldObjects so the two renderers
// agree. `gx`/`gy` are the tile's place in the map window; the camera's offset is applied below.
//
// Cloud deck: a second pass over the same scene after the world blit. Colour is cleared, depth kept,
// so the cards test against the city (context.drawCloudDeck). Returns null with no scene.
// The sky, drawn before the world pass (gl/sky.js). Null with no scene; the caller paints 2-D.
export function glSkyPass(id, s) {
  const g = scenes.get(id);
  if (!g || !g.view || !g.canvas || !g.view.gl) return null;
  if (g.view.lost && g.view.lost()) return null;
  return drawSky(g.view.gl, g.canvas, s) ? (blitOf(g) || g.canvas) : null;
}

export function glCloudPass(id, cam, cards, opts = {}) {
  const g = scenes.get(id);
  if (!g || !g.view || !g.canvas || !cards || !cards.length) return null;
  if (g.view.lost && g.view.lost()) return null;
  const dpr = cam && cam.W ? g.canvas.width / cam.W : 1;
  const cssH = opts.cssH || (dpr > 0 ? g.canvas.height / dpr : g.canvas.height);
  // ⚠ The plain camera: cards are camera-relative. Rebind the float target so the city's depth is
  // reachable; a fresh one would put clouds in front of every tower.
  const hdrOn = g.view.beginTarget(opts);
  const n = g.view.drawCloudDeck(cam, cards, cssH, opts);
  if (hdrOn) {
    g.view.composite({
      bloom: opts.glBloom > 0 ? opts.glBloom : 0,
      threshold: HDR_TUNE.threshold, knee: HDR_TUNE.knee,
      tonemap: opts.glTonemap > 0 ? opts.glTonemap : 0,
      exposure: opts.glExposure > 0 ? opts.glExposure : 1,
    });
  }
  return n ? { cards: n, canvas: g.canvas, blit: blitOf(g) } : null;
}

// The deck as a raymarched volume, as glCloudPass. Null means it drew nothing; the caller uses cards.
export function glCloudVolPass(id, cam, vol, opts = {}) {
  const g = scenes.get(id);
  if (!g || !g.view || !g.canvas || !g.view.drawCloudVolume || !vol) return null;
  if (g.view.lost && g.view.lost()) return null;
  const dpr = cam && cam.W ? g.canvas.width / cam.W : 1;
  const cssH = opts.cssH || (dpr > 0 ? g.canvas.height / dpr : g.canvas.height);
  const hdrOn = g.view.beginTarget(opts);
  const n = g.view.drawCloudVolume(cam, vol, cssH, opts);
  if (hdrOn) {
    g.view.composite({
      bloom: opts.glBloom > 0 ? opts.glBloom : 0,
      threshold: HDR_TUNE.threshold, knee: HDR_TUNE.knee,
      tonemap: opts.glTonemap > 0 ? opts.glTonemap : 0,
      exposure: opts.glExposure > 0 ? opts.glExposure : 1,
    });
  }
  return n ? { cells: n, canvas: g.canvas, blit: blitOf(g) } : null;
}

// The cabin alone after the world composite (drawInteriorAlone), with the shifted camera.
export function glInteriorPass(id, cam, opts = {}) {
  const g = scenes.get(id);
  if (!g || !g.view || !g.canvas || !g.view.drawInteriorAlone || !cam) return null;
  if (g.view.lost && g.view.lost()) return null;
  const camAt = (cam.ox || cam.oy) ? { ...cam, fx: (cam.fx || 0) + cam.ox, fy: (cam.fy || 0) + cam.oy } : cam;
  const dpr = cam.W ? g.canvas.width / cam.W : 1;
  const cssH = opts.cssH || (dpr > 0 ? g.canvas.height / dpr : g.canvas.height);
  const n = g.view.drawInteriorAlone(camAt, cssH, opts.under || 0, opts.underD || 0);
  return n ? { faces: n, canvas: g.canvas, blit: blitOf(g) } : null;
}

export function glWorldPass(id, host, cells, cam, deps, opts = {}) {
  const W = host.width, H = host.height;
  // ⚠ The canvas is device pixels and the camera CSS pixels; the projection needs camera units
  // (cssH), the viewport device pixels. Invisible at dpr 1, which is every test canvas.
  const dpr = cam && cam.W ? W / cam.W : 1;
  const cssH = opts.cssH || (dpr > 0 ? H / dpr : H);
  // ⚠ The near plane is resolved once and stamped on `cam`: every pass shares one depth buffer, and
  // two near planes read as z-fighting. See `nearFor`.
  // Underwater (plugins/submersible): the eye goes below the surface; floor, roads and mirror drop,
  // the seabed replaces them, the rest fogs to water. ⚠ Rides FLOOR_STATE, not a new opts key.
  const SUB = opts.floor && opts.floor.sub > 0 ? opts.floor.sub : 0;
  const SUBSCENE = opts.floor ? opts.floor.subScene : null;
  if (opts.floor && opts.floor.camEH != null && cam) cam = { ...cam, EH: opts.floor.camEH };
  if (SUB && cam) {
    // ⚠ Fog to the horizon colour, not the water's base colour, or hulls show as pale ghosts.
    const wc = (SUBSCENE && SUBSCENE.horizon) || [0.03, 0.14, 0.18];
    const far = (SUBSCENE && SUBSCENE.fogFar) || 3.6;
    // Above-surface layers are emptied (not skipped) so each still runs its bookkeeping.
    // ⚠ Eased over the first metre (about 0.14 tiles), never switched; lights go at half-way.
    const fk = Math.min(1, SUB / 0.14);
    opts = { ...opts, fogBand: { col: wc, amt: 0.35 + 0.65 * fk, near: 0.2, far: far + (1 - fk) * 30 }, glMirror: 0, glFogH: 0,
      ...(fk > 0.5 ? { sprites: [], curtain: [], decals: [], strokes: [], scatter: [] } : null) };
  } else if (opts.floor && (opts.floor.dunkFog ?? opts.floor.seaUnder) > 0.01 && cam) {
    // A wave over a low camera (glSeaDunk): fog closes the view so the city isn't seen through water.
    const b = opts.floor.seaBody || [0.05, 0.25, 0.32];
    const wc = [b[0] * 0.6, b[1] * 0.6, b[2] * 0.6];
    // Eased by windshield.js (SUB_FX.fog).
    const fk = Math.min(1, opts.floor.dunkFog ?? 1);
    opts = { ...opts, fogBand: { col: wc, amt: fk, near: 0.2, far: 3.6 + (1 - fk) * 30 }, glMirror: 0, glFogH: 0 };
    if (fk > 0.5) opts = { ...opts, sprites: [], curtain: [], decals: [], strokes: [], scatter: [] };
  }
  // ⚠ No waterline shading with the eye underwater: it painted the hull one teal silhouette. The band
  // fog does the distance; she gets the water tint and caustics (uUnder).
  const SOLID_WATER = SUB ? { under: Math.min(1, SUB / 0.14), underD: SUB * 7 } : { water: opts.ownWater };
  if (cam) cam.near = nearFor(cam, cssH, opts.nearFit == null ? 1 : opts.nearFit);
  setJitter(0, 0);
  if (!W || !H) return null;
  const g = sceneGL(id, W, H, opts.msaa == null ? 1 : opts.msaa, opts.glTransfer > 0);
  // No WebGL2, or the context was lost: return null (the caller already suppressed the 2-D mass).
  // ⚠ Release the scene, don't just delete it, or recovery runs the page out of contexts.
  if (!g.view) { glDisposeScene(id); return null; }
  if (g.view.lost && g.view.lost()) { glDisposeScene(id); return null; }
  // Bench profiling: with `window.__glPT` set, each view method's CPU time accumulates in it by name.
  if (typeof window !== 'undefined' && window.__glPT && !g.view.__timed) {
    g.view.__timed = true;
    for (const k of Object.keys(g.view)) {
      const fn = g.view[k];
      if (typeof fn !== 'function' || k === 'lost') continue;
      g.view[k] = function (...a) {
        const T = window.__glPT; if (!T) return fn.apply(this, a);
        const t0 = performance.now();
        try { return fn.apply(this, a); } finally { T[k] = (T[k] || 0) + performance.now() - t0; }
      };
    }
  }

  // massKeep (see uploadKept in context.js): positions are world tiles less an anchor (g.anchor);
  // the shader adds anchor less this window's centre. Re-anchored with a full build past MASS_REANCHOR.
  const keepM = opts.massKeep > 0 && !!g.view.uploadKept;
  const c0 = cells[0], wcx = c0 ? c0.wx - c0.gx : 0, wcy = c0 ? c0.wy - c0.gy : 0;
  const key = windowKey(cells, keepM);
  if (!keepM) g.anchor = null;
  if (CHURN) for (const it of cells) {
    const n = it.c.bn || it.c.bt || '?';
    let set = CHURN.get(n); if (!set) CHURN.set(n, set = new Set());
    set.add(meshParams(it));
  }
  // The atlas copies baked textures, which change at dusk steps with no change to the city.
  const epoch = deps.texEpoch ? deps.texEpoch(opts.nb || 0) : '';
  // The material page (RENDER_TUNE.glMatPage) is baked beside the atlas from the same keys, so
  // turning it on or off is one rebuild like any other change of surfaces.
  const matOn = opts.glMatPage > 0 && !!deps.wallMatMixed;
  // The surface page (RENDER_TUNE.glSurfPage), the same way.
  const surfOn = opts.glSurfPage > 0 && !!deps.wallSurf;
  if (key !== g.key || epoch !== g.epoch || matOn !== g.matOn || surfOn !== g.surfOn) {
    g.matOn = matOn; g.surfOn = surfOn;
    // ⚠ The placed mesh is never materialised: a tile is its shared faces plus an offset.
    const groups = [];
    const need = new Set();
    let nFaces = 0;
    let full = !keepM;
    if (keepM && (!g.anchor || Math.max(Math.abs(wcx - g.anchor.x), Math.abs(wcy - g.anchor.y)) > MASS_REANCHOR)) { g.anchor = { x: wcx, y: wcy }; full = true; }
    const ax = keepM ? g.anchor.x : 0, ay = keepM ? g.anchor.y : 0;
    for (const it of cells) {
      const faces = tileMesh(deps, it);
      // Window grid variant from the power state; null (feed up) is almost always.
      // ⚠ The mesh is shared per model but power isn't, so the variant rides the group, never `texKey`.
      const pwr = deps.glPowerForCell ? deps.glPowerForCell(it.c) : null;
      const win = pwr ? pwr.win : null;
      for (const f of faces) if (f.texKey) need.add(texVariant(f.texKey, win));
      groups.push({ ox: keepM ? it.wx - ax : it.gx, oy: keepM ? it.wy - ay : it.gy, key: keepM ? tileKeyOf(it, true) : undefined,
        jit: it.jit || 0, faces, win, nb: pwr ? pwr.nb : null });
      nFaces += faces.length;
    }
    // The atlas is keyed on the set of surfaces, which changes far less often than the buildings.
    const akey = [...need].sort().join('|') + '@' + epoch + (matOn ? '#m' : '') + (surfOn ? '#s' : '');
    // A repacked atlas moves every rect, so the kept mass is packed again whole.
    if (akey !== g.atlasKey) full = true;
    if (akey !== g.atlasKey) {
      const { wallTexMixed, roofTex, wallMatMixed, wallSurf, roofSurf } = deps;
      const tiles = [];
      for (const tk of need) {
        const roof = tk[0] === 'r';
        const bar = tk.indexOf(TEX_WIN_SEP);
        const pk = bar === -1 ? tk.slice(2) : tk.slice(2, bar);
        const bare = pk.endsWith(TEX_BARE), pal = bare ? pk.slice(0, -TEX_BARE.length) : pk;
        // undefined is the ordinary bake.
        const win = bar === -1 ? undefined : +tk.slice(bar + 1);
        const canvas = roof ? roofTex(pal, opts.night || 0) : wallTexMixed(pal, opts.nb || 0, win, bare);
        const mat = matOn && !roof ? wallMatMixed(pal, opts.nb || 0, win, bare) : null;
        // Height doesn't vary with hour or grid, so this is keyed on the palette alone.
        const surf = !surfOn ? null : roof ? (roofSurf ? roofSurf(pal) : null) : wallSurf(pal, bare);
        if (canvas && canvas.width) tiles.push({ key: tk, canvas, mat, surf });
      }
      g.atlas = buildAtlas(tiles, g.view.maxTexture || 2048);
      if (g.view.setMatPage) g.view.setMatPage(g.atlas ? g.atlas.matCanvas : null);
      if (g.view.setSurfPage) g.view.setSurfPage(g.atlas ? g.atlas.surfCanvas : null);
      // A page the device can't hold is refused; the shader falls back to flat colours. Warned once.
      if (!g.atlas && !g.warnedAtlas) { g.warnedAtlas = true; console.warn(`[glass2] the texture atlas for ${tiles.length} surfaces does not fit this device (max ${g.view.maxTexture}) — drawing flat colours`); }
      g.view.setAtlas(g.atlas ? g.atlas.canvas : null);
      g.atlasKey = akey;
    }
    // Resolved per face at fill time: faces are shared across tiles and scenes.
    // ⚠ The group is passed because the window variant belongs to the tile, not the shared face.
    // The dusk blend rides `epoch`, so trim and wall textures cross dusk in one rebuild.
    const rectOf = (f, grp) => (g.atlas && f.texKey ? g.atlas.rect.get(texVariant(f.texKey, grp && grp.win)) : null);
    if (keepM) g.view.uploadKept(groups, rectOf, opts.nb || 0, full);
    else g.view.uploadGroups(groups, rectOf, opts.nb || 0);
    builds++;
    g.key = key;
    g.epoch = epoch;
    g.faces = nFaces;
  }
  // Every frame, built or not: the window moves under a kept buffer without changing its key.
  if (g.view.setMassShift) g.view.setMassShift(g.anchor ? g.anchor.x - wcx : 0, g.anchor ? g.anchor.y - wcy : 0);

  // The sub-tile offset the mesh doesn't carry, folded into fx/fy so camera.js (held by gl:parity) is unchanged.
  const camAt = (cam.ox || cam.oy)
    ? { ...cam, fx: (cam.fx || 0) + cam.ox, fy: (cam.fy || 0) + cam.oy }
    : cam;
  // ⚠ Lights are picked from the plain camera (see pickLights). Fade state lives on the scene.
  // ⚠ Use the frame's clock (`opts.now`), never performance.now(): a pass called twice would stall
  // the ramp, and headless tests step `now`.
  if (!g.litW) g.litW = new Map();
  const tNow = (opts.now || 0) / 1000;
  const dt = Math.min(LIGHT_DT_MAX, Math.max(0, tNow - (g.litT ?? tNow)));
  g.litT = tNow;
  let lightList = null;
  // Every light, uncapped and unfaded, for the light grid (glCluster). See docs/proposals/glass-lights-and-taa.md.
  let gridLights = null;
  // ⚠ Clamp to the compiled ceiling here only: slots past MAX_LIGHTS would be dropped silently.
  const SLOTS = Math.max(1, Math.min(MAX_LIGHTS, Math.round(opts.glLightSlots > 0 ? opts.glLightSlots : MAX_LIGHTS)));
  if (opts.glLights !== 0) {
    const ranked = pickLights(cam, opts.sprites, opts.night || 0, g.litHeld, SLOTS, g.litW);
    lightList = ranked ? fadeLights(ranked, g.litW, dt, SLOTS) : null;
    if (opts.glCluster === 1 && ranked) gridLights = ranked.all || ranked;
    // ⚠ Held is what was wanted this frame, not what's lit, or a fading light re-elects itself.
    g.litHeld = ranked ? new Set(ranked.slice(0, SLOTS).map((e) => e.key)) : null;
  } else { g.litHeld = null; g.litW.clear(); }
  // Built once so the mirror prepass and main pass share it. null (glCluster 0) clears it.
  if (g.view.setLightGrid) g.view.setLightGrid(gridLights);
  // The mass shader gets lights only when a term needs them: the wash (night only; a noon wash is
  // the saturation bug), the wet specular (raining), the shaft, the lamp lift. A dry day pays nothing.
  const washOn = LIGHT_TUNE.gain * Math.min(1, Math.max(0, opts.night || 0)) > 0.01;
  const wetOn = (opts.glWet > 0 && opts.glWetWall > 0);
  // In-scattering reads the list too, or a lamp's shaft stops at the kerb. ⚠ Night-scaled: a lamp
  // beam is invisible in daytime fog, and unscaled it blew a foggy noon street to white.
  const scatterNow = (opts.glScatter || 0) * Math.min(1, Math.max(0, opts.night || 0));
  const scatterOn = scatterNow > 0;
  // Lamps lift the night dim near them: only at night, and only when the night dims.
  const lampLift = LIGHT_TUNE.lift * Math.min(1, Math.max(0, opts.night || 0)) / (LIGHT_TUNE.wet || 1);
  const liftOn = lampLift > 0.01 && (opts.glNightDark || 0) > 0;
  // A sign on its own wall: night only, and only with the grid.
  const signLift = LIGHT_TUNE.sign * Math.min(1, Math.max(0, opts.night || 0));
  const signOn = signLift > 0.01 && opts.glCluster === 1;
  const wallLights = (washOn || wetOn || scatterOn || liftOn) ? lightList : null;
  // The skyline strip the glass reflects (gl/skyline.js), from the same cells and eye.
  // ⚠ Set before `draw`, which binds it.
  if ((opts.glEnvCity == null ? 1 : opts.glEnvCity) > 0 && g.view.setSkyline) g.view.setSkyline(cells, eyePos(camAt), skylineFaces(deps, cells));
  // The wall walks the light grid for the lift, wash and wet lobe (not the shaft, which keeps slots).
  const drawOpts = { ...(opts.draw || {}), lights: wallLights, gridWall: washOn || wetOn || liftOn || signOn, signLift: signOn ? signLift : 0, lampLift: liftOn ? lampLift : 0, lightWrap: LIGHT_TUNE.wrap,
    lightFocus: LIGHT_TUNE.focus, cssH,
    ao: opts.glAO || 0, aoFall: AO_TUNE.fall, bakedAo: opts.glBakedAo || 0, sunShadow: sunShadowFor(g, opts),
    propShadow: propShadowFor(cam, camAt, cssH, dpr, opts),
    // ⚠ The eye comes off `camAt`, the shifted camera; the plain cam slides every highlight.
    eye: eyePos(camAt),
    // ⚠ The city in the glass is rebuilt every frame, not with the mass buffer, or it snaps per tile.
    envCity: opts.glEnvCity == null ? 1 : opts.glEnvCity, envDim: opts.glEnvDim,
    matStr: opts.glMat == null ? 1 : opts.glMat,
    specStr: opts.glSpec == null ? 1 : opts.glSpec,
    // Snow on up-facing surfaces, off the geometric normal (see context.js).
    snow: opts.glSnow > 0 ? opts.glSnow : 0,
    // Wet walls: `glWetWall` 0 hands the shader 0; the wet road reads `opts.glWet` directly.
    wet: (opts.glWet > 0 && opts.glWetWall > 0) ? opts.glWet * opts.glWetWall : 0,
    // Ground fog density, shared by three shaders (gl/fog.js).
    fogH: opts.glFogH || 0, fogHScale: FOG_H_SCALE, scatter: scatterNow,
    bumpStr: opts.glBump == null ? 1 : opts.glBump,
    matPage: matOn ? 1 : 0,
    envCube: opts.glEnvCube > 0 ? 1 : 0, envSky: opts.envSky || null, ggx: opts.glGGX > 0 ? 1 : 0,
    surfPage: surfOn ? 1 : 0, heightGain: opts.glHeightGain > 0 ? opts.glHeightGain : 0.33,
    metalRefl: opts.glMetalRefl == null ? 1 : opts.glMetalRefl,
    // The bevel defaults off: benches reach this too and must only get what they ask for.
    // ⚠ This object is built, not spread from opts, so `hdr` must be named here or every layer
    // renders into eight bits.
    hdr: opts.hdr,
    // Linear light (gl/colour.js): 1 is the linear buffer, 2 also shades in linear (uLinIn).
    linear: opts.glLinear > 0 ? opts.glLinear : 0,
    bevel: opts.glBevel || 0, bevelTilt: BEVEL_TILT,
    // Screen-space occlusion, default off like the bevel.
    ssao: opts.glSsao || 0, ssaoRes: opts.glSsaoRes, ssaoRadius: SSAO_TUNE.radius, ssaoBias: SSAO_TUNE.bias,
    // The cel look (glToon, glInk), default off. Ink width is CSS px, scaled by dpr.
    toon: opts.glToon || 0, toonBands: opts.glToonBands,
    ink: opts.glInk || 0, inkStep: Math.max(1, Math.round((opts.glInkPx > 0 ? opts.glInkPx : 1) * dpr)), inkFar: opts.glInkFar,
    // The far dissolve drawn after the ground rather than with the mass. See drawFade below.
    fadeSplit: (opts.glHazeSplit == null ? 1 : opts.glHazeSplit) > 0,
    mat: deps.matTable || null };
  // Mirror prepass first: the road draws before any neon exists. ⚠ Plain camera, not 'camAt': lights
  // are camera-frame, road quads map-window; they agree on screen, where the ground looks it up.
  // The rig, in map-window tiles (shares camAt), uploaded before both passes and before the mirror.
  // ⚠ 'glShip 0' removes it at collection; gating the upload still pays the transform.
  // ⚠ The room is split out here (inside the near plane, own clip range); splitting it in windshield.js
  // needs an 'installGL' allowlist key ('gl:opts').
  const room = (opts.ship || []).filter((f) => f.interior);
  const rig = room.length ? (opts.ship || []).filter((f) => !f.interior) : opts.ship;
  // Own-ship faces in their own frame (`mp`, `shipModel`) go to their own layer; called every frame
  // so a frame with no ship clears it.
  const shipModel = opts.ship && opts.ship.shipModel;
  const own = shipModel && rig ? rig.filter((f) => f.mp) : null;
  const rest = own && own.length ? rig.filter((f) => !f.mp) : rig;
  if (g.view.uploadShip) g.view.uploadShip(own || [], shipModel || null, (opts.ship && opts.ship.shipState) || null);
  if (g.view.uploadSolids) g.view.uploadSolids([rest, opts.bay, opts.fauna]);
  if (g.view.uploadInterior) g.view.uploadInterior(room, (opts.ship && opts.ship.interiorModel) || null, (opts.ship && opts.ship.interiorLight) || null, (opts.ship && opts.ship.interiorAtt) || null);
  const mirrorGain = opts.glMirror > 0 ? opts.glMirror : 0;
  // The mirror runs for wet roads and for the sea. ⚠ Only with water in the window (`waterTiles`);
  // inland it re-rendered the city into a buffer nothing read.
  const seaWants = opts.floor && opts.floor.swell > 0 && opts.floor.seaRefl > 0 && opts.floor.seaRoll > 0
    && opts.floor.waterTiles !== 0;
  const reflTex = (mirrorGain > 0 && (opts.glWet > 0 || seaWants) && g.view.drawMirror)
    ? g.view.drawMirror(cam, { sprites: opts.sprites, decals: opts.decals, cssH, scale: opts.glMirrorRes,
        // The sky in the puddle: clouds composite over ground.js's flat fallback.
        clouds: (opts.glMirrorSky === 0) ? null : opts.clouds, cloudState: opts.cloudState,
        massCam: camAt, mass: opts.glMirrorMass == null ? 1 : opts.glMirrorMass, massOpts: drawOpts,
        // ⚠ The band (`opts.fogBand`), never massOpts' `fog`, which is a colour array and threw.
        fog: opts.fogBand })
    : null;
  if (SUB) drawOpts.skipMass = true;   // see skipMass in context.js
  // TAA (glTaa; gl/taa.js): layers until the split below are jittered. The reprojection matrix is
  // taken unjittered, first. Last frame's float target gates it.
  let taaJit = null, taaVP = null, taaDone = false;
  if (opts.glTaa > 0 && g.view.taaSplit && (!g.view.hdrLive || g.view.hdrLive() || !g.taa)) {
    taaVP = viewProjMatrix(camAt, cssH);
    g.taaN = (g.taaN || 0) + 1;
    taaJit = jitterFor(g.taaN, g.canvas.width, g.canvas.height);
    setJitter(taaJit.x, taaJit.y);
  } else g.taa = null;
  g.view.draw(camAt, drawOpts);
  // What the layers are really drawing into: a device that refused the float format renders 8-bit.
  const hdrLive = g.view.hdrLive ? g.view.hdrLive() : opts.hdr > 0;
  // ⚠ The floor goes after the mass: 'draw()' clears colour and depth.
  // ⚠ Wet reflections go on the ground pass, not the floor: GROUND_FULL draws paved tiles over it.
  // ⚠ Solids draw inside the depth-buffered half, so the city can hide them. The count covers the
  // rig and the depot shed. They take the city's lights and night.
  const solids = g.view.drawSolids ? g.view.drawSolids(camAt, cssH, { fog: opts.fogBand, ...SOLID_WATER,
    lights: lightList, lightWrap: LIGHT_TUNE.wrap, lightFocus: LIGHT_TUNE.focus,
    // The cel look for the cloth (gl/cloth.js).
    toon: opts.glToon || 0, toonBands: opts.glToonBands,
    nightDim: 1 - (opts.night || 0) * (opts.glNightDark || 0) }) : 0;

  const fl = opts.floor;
  // The floor's wet terms stay off (GROUND_FULL repaints every paved tile they'd touch); its snow is
  // on, because snow on open terrain only the floor can draw.
  if (fl) { fl.wet = 0; fl.wetLights = null; fl.snow = opts.glSnow > 0 ? opts.glSnow : 0; }
  // Mud ponds read the same level as the road puddles.
  if (fl) fl.mud = opts.glPond == null ? (opts.glWet > 0 ? opts.glWet : 0) : opts.glPond;
  // The sea takes the same list as `seaLights`; `wetLights` is off only because GROUND_FULL repaints tarmac.
  if (fl) fl.seaLights = roadLights(lightList);
  // Wheel tracks: ⚠ one buffer for both ground shaders so a track crosses the join; none for the mass.
  if (fl) fl.tracks = opts.tracks || null;
  // ⚠ The floor gets the frame's near plane (it doesn't take `cam`; see gl:floorcam). FOG_H_SCALE is
  // folded into a copy here (windshield.js mustn't import gl/; FLOOR_STATE is read after the frame).
  // Underwater the seabed replaces the floor.
  if (SUB && g.view.drawSeabed) g.view.drawSeabed(camAt, SUBSCENE, cssH, dpr, eyePos(camAt), performance.now() / 1000);
  // Waterline split (drawWaterSplit): the sea surface draws only above the hull's waterline, via
  // scissor. The viewport is the canvas size; never read it back with getParameter (a GPU stall).
  const splitF = !SUB && opts.floor && opts.floor.split > 0 && opts.floor.split < 1 ? opts.floor.split : 0;
  const sgl = splitF ? g.view.gl : null;
  if (sgl) {
    const vp = [0, 0, g.canvas.width, g.canvas.height];
    sgl.enable(sgl.SCISSOR_TEST);
    sgl.scissor(vp[0], vp[1] + Math.round(vp[3] * (1 - splitF)), vp[2], Math.round(vp[3] * splitF));
  }
  const floor = SUB ? 0 : g.view.drawFloor(opts.floor ? { ...opts.floor, fogHScale: FOG_H_SCALE } : opts.floor, cam.near);
  // ⚠ The sea mesh draws after the floor, which writes a flat plane's depth that would hide every
  // trough. Shifted camera: its vertices are map-window tiles.
  const water = opts.floor && g.view.drawWater
    ? g.view.drawWater(camAt, opts.floor, cssH, reflTex ? {
        tex: reflTex, sky: opts.skyStrip || null,
        w: g.canvas ? g.canvas.width : 1, h: g.canvas ? g.canvas.height : 1,
      } : null) : 0;
  if (sgl) sgl.disable(sgl.SCISSOR_TEST);
  // Bubbles and suspended matter, after the surface so a bubble is seen against it.
  if (SUBSCENE && g.view.drawSeabedPoints) g.view.drawSeabedPoints(camAt, SUBSCENE, cssH, dpr);
  // ⚠ Road quads are map-window tiles, so the shifted camera, after the floor (eps ladder in windshield.js).
  const ground = SUB ? 0 : g.view.drawGround(camAt, opts.ground, cssH, {
    // No haze band: per-quad alpha already fades the road.
    fog: opts.fogBand,
    // The sky's two ends, for water where the city doesn't cover it (see `uSkyHor` in ground.js).
    skyBand: opts.skyBand,
    // The sky itself; the pair above is the fallback (see `uSky` in ground.js).
    skyStrip: opts.glMirrorSky === 0 ? null : opts.skyStrip,
    // Wet darkening contrast (see `uWetDark` in ground.js).
    wetDark: opts.glWetDark,
    // ⚠ Not gated on there being lights: pickLights returns null by day, which once dried the road in
    // a deluge. The shader skips reflections when `uNWet` is 0.
    wet: opts.glWet > 0 ? opts.glWet : 0,
    // Lamp pools on the road (see 'uPool' in ground.js). ⚠ Not gated on lights, as `wet`.
    pool: opts.glPool > 0 ? opts.glPool : 0, night: opts.night || 0,
    nightDim: 1 - (opts.night || 0) * (opts.glNightDark || 0),
    fogH: opts.glFogH || 0, fogHScale: FOG_H_SCALE, scatter: scatterNow,
    // Standing water (the puddle level), as opposed to surface wetness. See POND_RISE_S in windshield.js.
    pond: opts.glPond == null ? (opts.glWet > 0 ? opts.glWet : 0) : opts.glPond,
    // Snow depth, ungated like `wet`.
    snow: opts.glSnow > 0 ? opts.glSnow : 0,
    // ⚠ Snow colour carries the night (see 'uSnowCol' in ground.js).
    snowCol: opts.snowCol || null,
    pudRoad: opts.glPudRoad,
    tracks: opts.tracks || null,
    lids: opts.lids || null,
    // ⚠ The road takes its own six via roadLights: raw, washes sit past `MAX_WET` and never reach it.
    wetLights: roadLights(lightList),
    // With the grid on, streak, glint and pool take every light (gl/lightgrid.js).
    gridLights,
    // Lamp pools take the whole list; the six are only the reflection budget.
    poolLights: lightList,
    // ⚠ The camera's ground point (rig `cam.ox/oy` plus eye offset `cam.ex/ey`), not the rig alone,
    // or external seats solve reflections from the truck. Never a bare `ox`: that's local to pickLights.
    eyeX: (cam.ox || 0) + (cam.ex || 0), eyeY: (cam.oy || 0) + (cam.ey || 0),
    // ⚠ `cam.EH` in capitals (the camera's name); `cam.eh` is undefined and froze the Fresnel gate.
    eyeH: opts.eyeH == null ? (cam.EH == null ? 0.2 : cam.EH) : opts.eyeH,
    // ⚠ The window centre comes from opts, not the floor: `opts.floor` is null with glFloor off.
    wcX: (opts.wc && opts.wc.x) || 0, wcY: (opts.wc && opts.wc.y) || 0,
    // ⚠ The canvas's own size, not the reflection buffer's (see `uReflVP`).
    reflTex, reflGain: mirrorGain, pudScale: opts.glPuddle, time: tNow, ripple: opts.glRipple,
    glint: opts.glGlint,
    groundBias: opts.glGroundBias,
    vpW: g.canvas ? g.canvas.width : 0, vpH: g.canvas ? g.canvas.height : 0,
  });
  // ⚠ The far dissolve after floor, sea and roads: a translucent block drawn with the mass claimed
  // its whole silhouette in depth and left a dark cut-out. Before people, lights and signs.
  const hazeFade = g.view.drawFade ? g.view.drawFade(camAt, drawOpts) : 0;
  // People after the ground: the pavement band is translucent paint above road level and would
  // blend over their feet. The mirror draws them with the solids (context.js).
  const actors = g.view.drawActors ? g.view.drawActors(camAt, cssH, { fog: opts.fogBand, lights: lightList,
    nightDim: 1 - (opts.night || 0) * (opts.glNightDark || 0) }) : 0;
  // The translucent half of the solids (rotor blades, blur disc; `film` in solids.js): no depth
  // write, so after floor, sea and road. The mirror draws the solid range only.
  const film = g.view.drawSolids ? g.view.drawSolids(camAt, cssH, { fog: opts.fogBand, film: true, ...SOLID_WATER }) : 0;
  // ⚠ Lights and the layers after them take the plain camera: they're camera-frame, only the cached
  // mesh is map-window. ⚠ Their gain needs the float target (exactly 1 without it), or glows clip white.
  // TAA split (gl/taa.js): everything above was jittered and resolved; everything below draws
  // unjittered and never enters history. `shift` is how far the window recentred since last frame.
  if (taaJit) {
    setJitter(0, 0);
    const now = opts.now || 0, wc = opts.wc || { x: 0, y: 0 }, p = g.taa;
    const shift = p ? [wc.x - p.wc.x, wc.y - p.wc.y] : [0, 0];
    const reset = !p || p.w !== g.canvas.width || p.h !== g.canvas.height || !(Math.abs(now - p.t) < TAA_TUNE.maxGapMs)
      || Math.abs(shift[0]) > TAA_TUNE.maxShift || Math.abs(shift[1]) > TAA_TUNE.maxShift;
    taaDone = g.view.taaSplit({ reproj: reset ? null : reprojMatrix(p.vp, taaVP, shift), jit: taaJit, reset });
    g.taa = taaDone ? { vp: taaVP, wc: { x: wc.x, y: wc.y }, w: g.canvas.width, h: g.canvas.height, t: now } : null;
    if (TAA_TUNE.debug) TAA_TUNE.last = { vp: taaVP, prev: p ? p.vp : null, shift, reset, cam: { fx: camAt.fx, fy: camAt.fy, ox: camAt.ox, oy: camAt.oy, near: camAt.near, back: camAt.back, EH: camAt.EH, sinh: camAt.sinh, cosh: camAt.cosh } };
  }
  const lights = g.view.drawSprites(cam, opts.sprites, cssH, hdrLive ? EMISSIVE_GAIN : 1);
  // ⚠ After the mass: depth-tested, writing none.
  const curtains = g.view.drawCurtain(cam, opts.curtain, cssH, opts.now);
  // ⚠ Signs carry their own per-quad gain (decals.js); never fold it into EMISSIVE_GAIN, which hits
  // every additive sprite. Cloth is the one decal that catches light, from `lightList` raw, night only.
  const clothN = Math.min(1, Math.max(0, opts.night || 0)) * LIGHT_TUNE.cloth;
  const clothLit = clothN > 0.01 && lightList ? {
    gain: clothN, lights: lightList.map((L) => ({ p: L.p, r: (L.r || 1) * LIGHT_TUNE.clothR,
      rgb: (L.rgbRaw || L.rgb).map((v) => v / (LIGHT_TUNE.wet || 1)) })),
  } : null;
  const decals = g.view.drawDecals(cam, opts.decals, cssH, hdrLive ? SIGN_EMISSIVE_GAIN : 0,
    { tube: opts.glNeonTube, flicker: opts.glNeonFlicker, now: opts.now }, clothLit);
  const decalBinds = g.view.decalCost ? g.view.decalCost() : null;
  // The wires, after the mass: depth-tested, writing none.
  const strokes = g.view.drawStrokes ? g.view.drawStrokes(cam, opts.strokes, cssH) : 0;
  // Scatter carries the renderer's fog curve, matching the 2-D fogTint.
  // Snow on scatter takes `snowBB` (ground depth with the billboard flag folded in), not `glSnow`,
  // so `RENDER_TUNE.glSnowBB = 0` turns off only this layer.
  const scatter = g.view.drawBillboards(cam, opts.scatter, cssH, opts.fogBand,
    { depth: opts.snowBB > 0 ? opts.snowBB : 0, col: opts.snowCol }, lightList);

  // ⚠ The cabin is last of the depth-buffered passes: it clears depth (drawInterior), and anything
  // drawn before it would otherwise paint over it. No fog. Skipped here when the seat draws it later
  // (glInteriorPass); uploaded either way.
  const interior = (!opts.interiorLater && g.view.drawInterior) ? g.view.drawInterior(camAt, cssH, { under: opts.floor ? (opts.floor.dunkFog || 0) : 0, underD: opts.floor ? Math.max(0, opts.floor.seaUnderD || 0) * 7 : 0 }) : 0;
  // ⚠ Composite last, after every layer, so bloom gathers from all of them. A no-op without the float path.
  const graded = g.view.composite({
    bloom: opts.glBloom > 0 ? opts.glBloom : 0,
    threshold: HDR_TUNE.threshold, knee: HDR_TUNE.knee,
    tonemap: opts.glTonemap > 0 ? opts.glTonemap : 0,
    exposure: opts.glExposure > 0 ? opts.glExposure : 1,
    // FXAA on the world composite only; the cloud deck is soft already.
    fxaa: opts.glFxaa > 0 ? 1 : 0,
  });
  // peak and mirrorPeak are closures so only a bench pays for the readback (hdr.js).
  if (graded) graded.peak = () => g.view.hdrPeak();
  const mirrorProbe = reflTex && g.view.mirrorPeak ? ((step) => g.view.mirrorPeak(step)) : null;
  // `shadowSize`, `wet`, `hdr` and `mirror` are reported because each can be zero or absent for
  // several reasons that all draw a correct picture; the number says which.
  // `mass` only for a harness that sets globalThis.__massDebug (massKeep's check).
  return { interior, faces: g.faces || 0, builds, mass: globalThis.__massDebug && g.view.massDebug ? g.view.massDebug() : undefined, lights, lit: lightList || [], taa: taaDone ? (g.taaN % TAA_TUNE.samples) + 1 : 0, lightGrid: g.view.groundGrid ? g.view.groundGrid() : null, wallGrid: g.view.wallGrid ? g.view.wallGrid() : null, curtains, decals, decalBinds, strokes, scatter, solids, film, hazeFade, ship: (opts.ship || []).length, bay: (opts.bay || []).length, fauna: (opts.fauna || []).length, actors, bbTex: g.view.billboardTextures ? g.view.billboardTextures() : 0, ground, floor, wet: opts.glWet || 0, snow: opts.glSnow || 0, tracks: opts.tracks ? opts.tracks.n : 0, mirror: reflTex ? mirrorGain : 0, mirrorPeak: mirrorProbe, shadowSize: g.view.shadowSize || 0, propShadow: g.view.propShadow || null, hdr: graded, canvas: g.canvas,
    // Handed over only with the city's depth in the float target: the cloud deck goes back for it (blitOf).
    blit: graded && g.view.hdrLive() ? blitOf(g) : null };
}


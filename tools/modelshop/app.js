// MODELSHOP — the client.
//
// It imports the REAL renderer. Nothing here draws a building, computes a camera, or
// knows what a segment is — every picture on the page comes out of renderModelPreview(),
// a named entry into windshield.js's own drawTypeModel. That is the whole reason the tool
// is worth trusting: there is no second renderer to disagree with the sim.
//
// ⚠ Quoting rule, from CLAUDE.md: inside a template literal, quote identifiers with
// 'single quotes', never backticks. Most markup here is built through the DOM instead.
import { initToolbox, toggleToolbox } from './toolbox.js';
import { glDraw, glHide, glShown, glAvailable } from './glview.js';
// The cost half of the spike. It registers window.__glBench and nothing else — a benchmark with
// a button is a benchmark somebody runs by accident.
import './glbench.js';
import {
  shapeModelRegistry, renderModelPreview, shapeForModel, shapeWireList,
  shapeConstantWarnings, shapeAdornCost, shapeLinearityError, shapeIsSeedVariant,
  ADORN_RICH, ADORN_NEAR, buildingScaleFor,
  renderVehiclePreview, VEHICLE_CLASSES, TRUCK_VARIANTS, vehicleBounds, previewFit,
  VEHICLE_PARAM_TABLE, vehicleParamBase, setVehicleParams, clearVehicleParams,
} from '/client/game/js/panels/windshield.js';
import {
  initEditor, renderEditor, editorRecordFor, editorDocFor, markDirty, renderPalette,
  pushUndoFor, undo, redo, openToolPicker, refreshToolbox,
} from './editor.js';

const $ = (id) => document.getElementById(id);

// The AUTHORING BASIS — the pair captureRawPass uses, so a number an author types is the
// number the capture solves at.
const BASIS = { fh: 0.4, h: 1 };
const SCALES = [[1, 1], [2, 1], [1, 2], [2, 3]];

// Buildings AND vehicles. They are two different renderers — a building is a drawTypeModel
// arm, a vehicle is a face list from aircraft3d — so an entry carries which one it is and
// the viewport branches once. A vehicle is not authored as mass: it has no capture, and what
// there is to change is the PARAMETER ROW its mesh is generated from (see the tuner below).
const VEHICLES = [
  ...VEHICLE_CLASSES.filter((c) => c !== 'truck').map((cls) => ({ key: 'vehicle:' + cls, vehicle: { cls, variant: '' }, m: { type: cls } })),
  ...TRUCK_VARIANTS.map((v) => ({ key: 'vehicle:truck/' + v, vehicle: { cls: 'truck', variant: v }, m: { type: 'truck ' + v } })),
  // ⚠ THE VIPER IS NOT A CLASS. `aircraftFaces` takes `armed` as a channel of its own, so the
  // attack helicopter is 'heli' with a flag rather than a tenth entry in VEHICLE_CLASSES — and
  // it was missing from this list entirely, which is how the one airframe with a bespoke mesh
  // ended up being the one you could not look at.
  { key: 'vehicle:heli/viper', vehicle: { cls: 'heli', variant: '', armed: true }, m: { type: 'viper' } },
];
const MODELS = [...shapeModelRegistry(), ...VEHICLES];
const entryOf = (key) => MODELS.find((r) => r.key === key) || null;
const isVehicle = (key) => !!entryOf(key)?.vehicle;
let selectedSeg = -1;
let glNote = '';   // what the GL spike drew, if it is on — see paintViewport
let lastCam = null;

const state = {
  key: MODELS[0]?.key || null,
  heading: 0, dist: 9, eye: 1.4, pitch: 0, panX: 0, panY: 0, vehSizeMul: 1,
  floors: 6, seed: 3, night: 0,
  E: [0, 1], tier: ADORN_RICH, wire: false, spin: false, gl: false, preset: 'cockpit',
  mode: 'move',
};

const editCache = new Map();
export function invalidateEdit(key) { editCache.delete(key); }
const modelOf = (key) => {
  if (!editCache.has(key)) editCache.set(key, editorRecordFor(key));
  return editCache.get(key) || MODELS.find((r) => r.key === key)?.m || null;
};
const bare = (key) => (key || '').replace(/^(named|type|vehicle):/, '');

// ⚠ fh AND h ARE DERIVED, NEVER SET. They used to be two sliders, which meant the preview
// could show a footprint and a storey stack the game never produces. The sim computes both
// from the tile — BUILDING_FOOT plus a per-seed jitter, and floors x FLOOR_Z — so the tool
// asks for that pair instead of inventing one. Floors is the control because floors is the
// thing the world actually authors (flags.floors).
const scale = () => buildingScaleFor(state.floors, state.seed);

// ── BROWSING FAMILIES ───────────────────────────────────────────────────────
// ⚠ A DISPLAY HEURISTIC, AND NOTHING ELSE READS IT. Everything in this registry is a
// BUILDING — aircraft and vehicles are a different renderer (aircraft3d.js) and are not
// in shapeModelRegistry at all, so "buildings vs aeroplanes" is not a split this tool can
// make yet. What it can do is stop 173 models being one flat alphabetical wall.
//
// Keyed off the arm's own type name, which is why it is a heuristic: an unmatched model
// lands in Other and nothing breaks. It must never become a table anything depends on —
// that would be Coldwater's content leaking into a THOMAS tool.
//
// Two signals, in order, and the FIRST one is the codebase's own rather than mine.
//
//   1. THE TYPE PREFIX. `asc_spire`, `trm_still`, `sw_kiln`, `dw_forge` — the arms are
//      already namespaced by the place that owns them, and that is 52 models sorted for
//      free. A prefix EARNS a group by having members (>= MIN_PREFIX below), derived at
//      load, so a new region groups itself and a compound name like `fuel_yard` or
//      `cold_storage` is not mistaken for one.
//   2. A KEYWORD FAMILY, for the unprefixed rest.
//
// The prefix names below are verified from the world, not guessed: a `dw_` building sits
// on region_deadwater, `sw_`/`trm_` on region_scarletwastes. An unknown prefix is shown
// raw rather than invented.
const PREFIX_NAMES = { asc: 'Ascendant', trm: 'Thornwarren', sw: 'Scarletwastes', dw: 'Deadwater' };
const MIN_PREFIX = 4;
const FAMILIES = [
  ['Towers & spires', /tower|spire|lux|high|solenne|halcyon|penthouse|aerie/],
  ['Industry & freight', /foundry|forge|works|fab|slag|refin|industr|dynamo|mill|yard|freight|warehouse|depot|storage|dock|wharf|container|chem|vats|truck|fuel|cold/],
  ['Shops & nightlife', /shop|store|bodega|bar|diner|noodle|cafe|coffee|bakery|butcher|market|casino|honky|club|comic|hardware|outfitter|laundr|salon|pawn|strip|boutique|showroom|atelier|stall|ration/],
  ['Civic & law', /police|precinct|civic|court|church|clinic|hospital|records|hall|school|library|bank|jail|gov|permits|embassy|sentinel/],
  ['Homes', /apartment|unit|tenement|house|home|residence|hab|motel|hotel|creche|dorm|inn/],
  ['Transport', /hangar|airfield|terminal|station|garage|rail|bus|tram|port/],
  ['Walls & infrastructure', /wall|gate|dam|bridge|pylon|infra|tunnel|mast|antenna|power|cistern|water/],
];

// Which prefixes are real, counted from the registry rather than listed.
const LIVE_PREFIXES = (() => {
  const n = {};
  for (const r of MODELS) {
    const p = /^([a-z]{2,6})_/.exec(r.m?.type || '');
    if (p) n[p[1]] = (n[p[1]] || 0) + 1;
  }
  return new Set(Object.entries(n).filter(([, c]) => c >= MIN_PREFIX).map(([p]) => p));
})();

function familyOf(key, m) {
  if (key && key.startsWith('vehicle:')) return key.startsWith('vehicle:truck') ? 'Road vehicles' : 'Aircraft';
  const t = (m && m.type) || '';
  if (t === 'authored') return 'Authored';
  const p = /^([a-z]{2,6})_/.exec(t);
  if (p && LIVE_PREFIXES.has(p[1])) return PREFIX_NAMES[p[1]] || p[1] + '_';
  for (const [name, re] of FAMILIES) if (re.test(t)) return name;
  // A named model with a bespoke arm and no other signal is, definitionally, a one-off
  // building somebody drew on purpose. "Landmarks" is a truer label for it than "Other".
  return key && key.startsWith('named:') ? 'Landmarks' : 'Other';
}
const FAMILY_ORDER = ['Authored', 'Aircraft', 'Road vehicles', ...Object.values(PREFIX_NAMES), ...FAMILIES.map((f) => f[0]), 'Landmarks', 'Other'];

// ── FRAMING IS DERIVED FROM THE MODEL ───────────────────────────────────────
// A shopfront is 0.8 tiles tall and Halcyon is 2.9, so one fixed distance either buries
// the shop or walks the tower out of frame, and an author spends the session dragging two
// sliders back to sensible. The roof comes out of the capture already running for the
// readouts, so this costs nothing.
function roofOf(m, fh, h) {
  const segs = shapeForModel(m, state.seed);
  if (!segs || !segs.length) return h;
  let top = 0;
  for (const s of segs) top = Math.max(top, s.z1[0] * fh + s.z1[1] * h + s.z1[2]);
  return Math.max(0.2, top);
}
// ── FRAMING IS SOLVED, NOT GUESSED ──────────────────────────────────────────
// It used to be a formula off the roof height (top * 1.25 + 2). That is a guess which
// happens to suit a mid-rise, and it leaves a shed tiny and a spire cropped — so the tool
// needed a Frame button to rescue it. Now the model's real bounds go to previewFit(),
// which solves the distance that fills the frame on whichever axis is tight, and framing
// happens on every selection and every change. Frame is a convenience, not a repair.
function buildingBounds(m) {
  const sc = scale();
  const segs = shapeForModel(m, state.seed);
  if (!segs || !segs.length) return { halfW: sc.fh, height: sc.h, baseH: 0 };
  const V = (p) => (p ? p[0] * sc.fh + p[1] * sc.h + p[2] : 0);
  let top = 0, halfW = 0;
  for (const s of segs) {
    top = Math.max(top, V(s.z1));
    // The RADIUS from the model axis, not the larger of the two offsets — the viewport
    // orbits, so the widest this can ever project is its distance out plus the piece's own
    // half-diagonal. Measuring per-axis frames a rotated building against the edges.
    const r = s.kind === 'drum' ? Math.max(V(s.rb), V(s.rt))
      : Math.min(V(s.hwRaw), 0.44) * Math.SQRT2;
    halfW = Math.max(halfW, Math.hypot(V(s.cx), V(s.cy)) + r);
  }
  // Spars sit outside the mass list but are part of the silhouette you are looking at.
  for (const sp of segs.spars || []) top = Math.max(top, V(sp.z1 ?? sp.wz1));
  return { halfW: Math.max(0.05, halfW), height: Math.max(0.05, top), baseH: 0 };
}

// The bounds of whatever is on screen, building or vehicle, in the units the camera works
// in. One place, so the fit and the locked orbit cannot disagree about where the model is.
function currentBounds() {
  if (isVehicle(state.key)) {
    const v = entryOf(state.key).vehicle;
    const b = vehicleBounds(v.cls, !!v.armed, v.variant);
    const sm = state.vehSizeMul || 1;
    return { halfW: b.halfW * sm, height: b.height * sm, baseH: b.baseH * sm };
  }
  return buildingBounds(modelOf(state.key));
}

// ── THE CAMERA LOOKS AT THE MODEL ───────────────────────────────────────────
// GLASS has a pitch term now (see `makeCam`), so this is what it always should have been: the
// camera is AIMED at the subject, rather than the picture being slid back into frame under it.
//
// What it replaces is worth keeping, because the whole viewport was shaped by the lack of it.
// With a fixed horizontal optical axis — `sy = horizonY + depth · (EH − wz) / f` — the only way
// to look down was to raise the eye and then shift the horizon by hand, so this function used to
// solve that shift for "put the subject's mid-height at the centre of the canvas". It kept the
// model in frame and it never actually tilted the view, which is why a high arc SHEARED the model
// instead of turning it. Now the pitch is solved instead, `panY` stays 0, and the arc is free:
// over the roof, under the belly, the whole way round.
//
//   pitch = atan2(eye − zMid, dist)      positive tips the view down, which is what rising needs
function aimAtModel() {
  const b = currentBounds();
  const zMid = (b.baseH || 0) + b.height / 2;
  state.pitch = Math.atan2(state.eye - zMid, Math.max(0.05, state.dist));
  state.panY = 0;
}

// ── WHAT STOPS THE CAMERA ENTERING THE MODEL ────────────────────────────────
// The RADIUS, and nothing else. An orbit holds its distance from the subject in three dimensions,
// so a camera that starts outside the model stays outside it however far round or over the top it
// goes — the depth distance `dist` shrinking to nothing at the pole is the camera being directly
// ABOVE the subject, not inside it.
//
// ⚠ Two clamps used to live here and both are gone, because both were working around the missing
// pitch term rather than around a real limit: a ceiling on the arc (a high eye sheared the model
// instead of turning it) and a floor under `dist` (which read as the camera being inside a long
// rig). With the view able to tilt, the arc is free and the only floor left is numerical.
const MIN_DEPTH = 0.05;

// Just short of the poles. At exactly straight up or straight down every heading projects the same
// picture, so a drag through the pole spins the model end for end under the mouse. A degree short
// costs nothing and removes the flip.
const POLE = Math.PI / 2 - 0.02;

// The cab stays a deliberate close crop rather than a fit — being too close to see all of
// it is the whole point of that seat.
function frameAt(bounds, which) {
  const view = $('view');
  const W = Math.max(1, view.width), H = Math.max(1, view.height);
  if (which === 'cab') {
    const f = previewFit(bounds, W, H, 1.35);
    return { dist: f.dist, eye: Math.max(0.06, bounds.height * 0.12), tier: ADORN_NEAR };
  }
  const f = previewFit(bounds, W, H, 0.72);
  return { dist: f.dist, eye: f.eyeH, tier: ADORN_RICH };
}

// ── the browser dialog ──────────────────────────────────────────────────────
function renderBrowser(filter) {
  const q = (filter || '').trim().toLowerCase();
  const rows = MODELS.filter((r) => !q || r.key.toLowerCase().includes(q) || String(r.m?.type || '').toLowerCase().includes(q));
  $('count').textContent = rows.length === MODELS.length ? MODELS.length + ' models' : rows.length + ' of ' + MODELS.length;

  const groups = new Map();
  for (const r of rows) {
    const fam = familyOf(r.key, r.m);
    if (!groups.has(fam)) groups.set(fam, []);
    groups.get(fam).push(r);
  }
  const order = [...FAMILY_ORDER, ...[...groups.keys()].filter((g) => !FAMILY_ORDER.includes(g))];

  const host = $('blist');
  host.textContent = '';
  for (const fam of order) {
    const list = groups.get(fam);
    if (!list || !list.length) continue;
    const h = document.createElement('div');
    h.className = 'grp';
    h.textContent = fam + '  (' + list.length + ')';
    host.append(h);
    for (const r of list.sort((a, b) => a.key.localeCompare(b.key))) {
      const it = document.createElement('div');
      it.className = 'item' + (r.key === state.key ? ' on' : '');
      const n = document.createElement('span'); n.textContent = bare(r.key);
      it.append(n);
      if (r.m?.type === 'authored') { const b = document.createElement('span'); b.className = 'badge'; b.textContent = '✎ editable'; it.append(b); }
      const k = document.createElement('span'); k.className = 'k';
      k.textContent = (r.key.startsWith('named:') ? 'named · ' : 'type · ') + (r.m?.type || '?');
      it.append(k);
      it.onclick = () => { select(r.key); $('browserdlg').close(); };
      host.append(it);
    }
  }
}

function select(key) {
  state.key = key;
  vehSaveMsg = '';
  refreshToolbox();
  selectedSeg = -1;
  invalidateEdit(key);
  $('modelname').textContent = bare(key);
  fillCompare();
  preset(state.preset);
}

// ── the viewport ────────────────────────────────────────────────────────────
function sizeCanvas(c) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(c.clientWidth * dpr));
  const h = Math.max(1, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
}

function previewOpts(over) {
  return {
    m: modelOf(state.key), name: bare(state.key).toUpperCase(),
    seed: state.seed, fh: scale().fh, h: scale().h, night: state.night, E: state.E,
    heading: state.heading, dist: state.dist, eyeH: state.eye, camPitch: state.pitch,
    panX: state.panX, panY: state.panY,
    tier: state.tier, wire: state.wire,
    ...over,
  };
}

// ⚠ THE ONE PLACE THE TWO RENDERERS ARE CHOSEN BETWEEN. Everything that paints the
// viewport goes through here, and that is not tidiness — the spin loop used to call
// renderModelPreview directly, so spinning while looking at an aircraft drew a BUILDING:
// modelOf() hands back a stub record for a vehicle key, drawTypeModel finds no arm for its
// type, and the switch falls through to the default shop arm. A second call site is a
// second chance to forget the branch.
function paintViewport() {
  const view = $('view');
  sizeCanvas(view);
  try {
    // ── THE GL SPIKE ────────────────────────────────────────────────────────
    // Drawn from the camera the 2-D pass just solved, over the top of it, so the comparison is
    // the same model at the same seat rather than two pictures taken at different times. It is
    // off unless asked for, and a vehicle has no captured mesh, so it falls through to the
    // renderer that can draw one.
    if (state.gl && !isVehicle(state.key)) {
      lastCam = renderModelPreview(view, previewOpts());
      const r = glDraw(view.parentElement, modelOf(state.key), lastCam, { mesh: { fh: scale().fh, h: scale().h, seed: state.seed } });
      // Kept rather than written straight to the HUD, because drawHud runs after this and would
      // overwrite it — which reads as the GL pass having silently done nothing.
      glNote = r.error ? ('GL: ' + r.error)
        : 'GL — ' + r.faces + ' faces, ' + Math.round(r.triangles) + ' triangles, ' + r.tiles + ' textures in a ' + r.atlas + ' atlas (depth-buffered, no sort, no adornments)';
      return;
    }
    glHide();
    glNote = '';
    if (isVehicle(state.key)) {
      const v = entryOf(state.key).vehicle;
      lastCam = renderVehiclePreview(view, {
        ...v, night: state.night, heading: state.heading, dist: state.dist, camPitch: state.pitch,
        eyeH: state.eye, panX: state.panX, panY: state.panY, sizeMul: state.vehSizeMul || 1,
      });
    } else {
      lastCam = renderModelPreview(view, previewOpts());
      paintSelection();
    }
  } catch (e) {
    const ctx = view.getContext('2d');
    ctx.fillStyle = '#2a0f10'; ctx.fillRect(0, 0, view.width, view.height);
    ctx.fillStyle = '#ff7b72'; ctx.font = '16px monospace';
    ctx.fillText('threw: ' + e.message, 20, 40);
  }
}

function draw() {
  paintViewport();
  if (isVehicle(state.key)) return drawVehicleRail();
  drawHud();
  drawScales();
  renderSidebar();
  renderDiff();
  renderEditor($('editor'), state.key, () => { invalidateEdit(state.key); draw(); });
}

// A vehicle: the same camera controls, no editing, and the rail says why.
function drawVehicleRail() {
  const v = entryOf(state.key).vehicle;
  $('hud').textContent = 'middle-drag to orbit · shift+middle or right-drag to pan · wheel to zoom — a vehicle is tuned as parameters';
  const meta = $('meta'); meta.textContent = '';
  row(meta, 'key', state.key);
  row(meta, 'class', v.cls);
  if (v.variant) row(meta, 'variant', v.variant);
  row(meta, 'family', familyOf(state.key, null));
  const ref = vehRowOf(v);
  row(meta, 'mesh', ref ? 'aircraft3d.js ' + ref.kind + '/' + ref.id : 'aircraft3d.js (hand-authored)');
  for (const id of ['scales', 'bake', 'checks', 'diffimgs', 'diffnum']) $(id).textContent = '';
  const ed = $('editor'); ed.textContent = '';
  drawVehicleTuner(ed, v);
  $('scaleread').textContent = '';
}

function drawHud() {
  if (glNote) { $('hud').textContent = glNote; return; }
  const doc = editorDocFor(state.key);
  const sel = selectedSeg >= 0 && doc && doc.segs[selectedSeg];
  $('hud').textContent = sel
    ? 'seg #' + selectedSeg + ' ' + doc.segs[selectedSeg].kind + ' · ' + state.mode
      + ' — drag to ' + state.mode + ', Shift for height · Del removes · Esc deselects'
    : 'middle-drag to orbit · shift+middle or right-drag to pan · wheel to zoom' + (doc ? ' · click a piece to select it' : ' · read-only (a code arm)');
}

function drawScales() {
  const host = $('scales');
  if (host.childElementCount !== SCALES.length) {
    host.textContent = '';
    for (const [sf, sh] of SCALES) {
      const fig = document.createElement('figure');
      const c = document.createElement('canvas');
      c.width = 280; c.height = 180;
      const cap = document.createElement('figcaption');
      cap.textContent = 'fh x' + sf + '  h x' + sh + (sf === 2 && sh === 3 ? '  (verify)' : '');
      fig.append(c, cap);
      host.append(fig);
    }
  }
  SCALES.forEach(([sf, sh], i) => {
    const c = host.children[i].querySelector('canvas');
    try {
      const top = roofOf(modelOf(state.key), BASIS.fh * sf, BASIS.h * sh);
      // Each thumbnail solves its own fit, so the strip compares SHAPES rather than sizes.
      const f = previewFit({ halfW: BASIS.fh * sf * 1.3, height: top, baseH: 0 }, c.width, c.height, 0.74);
      renderModelPreview(c, previewOpts({ fh: BASIS.fh * sf, h: BASIS.h * sh, dist: f.dist, eyeH: f.eyeH, panX: 0, panY: 0, wire: false }));
    } catch { /* the main viewport already reports the throw, in full */ }
  });
}

// ── THE VEHICLE TUNER ────────────────────────────────────────────
// Five airframes and four trucks are generated from a row of plain numbers, so those nine can be
// reshaped here. The rest — the Mayfly, the Cub, both helis, the wreck — are hand-authored
// meshes with no row, and the panel says so rather than showing an empty form.
//
// A change is live at once and SAVED on request. setVehicleParams writes into the running module
// so the viewport answers immediately; Save writes content/vehicle_models/<kind>_<id>.json and
// re-bakes, which is the same two steps a building model takes and for the same reason — the
// module the renderer imports must never disagree with the file the repo holds.
//
// ⚠ THE FILE IS THE WHOLE ROW, never the patch. A row is small and complete, and a file that said
// only what differs would need a base to differ FROM, which is the FW_DEFAULT spread the format
// deliberately resolved away.
//
// Only the SCALARS are exposed. A row also carries lists and sub-objects — engine stations, the
// glazing spec, the canopy — and a text box over a nested object is a way to paste in something
// that throws inside the mesh builder three frames later.
const vehPatch = new Map();          // '<kind>/<id>' -> the fields changed from the shipping row
// What the last save said. It is state rather than a line appended to the panel because saving
// redraws the panel, and a message appended to the old one is gone before it can be read.
let vehSaveMsg = '';
const vehRowOf = (v) => (VEHICLE_PARAM_TABLE[v.cls] ? { kind: VEHICLE_PARAM_TABLE[v.cls], id: v.cls }
  : v.cls === 'truck' ? { kind: 'truck', id: v.variant } : null);

function applyVehPatch(ref) {
  const key = ref.kind + '/' + ref.id;
  const patch = vehPatch.get(key);
  setVehicleParams(ref.kind, ref.id, patch && Object.keys(patch).length ? patch : null);
  draw();
}

function drawVehicleTuner(host, v) {
  const ref = vehRowOf(v);
  const note = document.createElement('div'); note.className = 'dim';
  if (!ref) {
    note.textContent = 'This mesh is hand-authored in aircraft3d.js rather than generated from a parameter row, so there is nothing here to tune. The five fixed-wing classes and the four trucks are.';
    host.append(note); return;
  }
  const base = vehicleParamBase(ref.kind, ref.id) || {};
  const patch = vehPatch.get(ref.kind + '/' + ref.id) || {};
  note.textContent = 'Tuning ' + ref.kind + '/' + ref.id + ' — Save writes content/vehicle_models/' + ref.kind + '_' + ref.id + '.json and re-bakes.';
  host.append(note);

  const keys = Object.keys(base).filter((k) => typeof base[k] === 'number' || typeof base[k] === 'boolean').sort();
  for (const k of keys) {
    const cur = k in patch ? patch[k] : base[k];
    const d = document.createElement('div'); d.className = 'fld';
    const lab = document.createElement('label'); lab.textContent = k; lab.style.flex = '0 0 74px';
    lab.title = 'ships as ' + base[k];
    const inp = document.createElement('input');
    if (typeof base[k] === 'boolean') {
      inp.type = 'checkbox'; inp.checked = !!cur; inp.style.flex = '0 0 auto';
    } else {
      inp.type = 'number'; inp.step = '0.005'; inp.value = String(cur);
    }
    if (k in patch) inp.classList.add('warn');
    const commit = () => {
      const val = inp.type === 'checkbox' ? inp.checked : Number(inp.value);
      if (inp.type === 'number' && !Number.isFinite(val)) return;
      const p = { ...(vehPatch.get(ref.kind + '/' + ref.id) || {}) };
      // Back to the shipping value is a DELETION, not a patch that happens to match — otherwise
      // the field stays flagged as changed and Reset has something to undo that is not a change.
      if (val === base[k]) delete p[k]; else p[k] = val;
      vehPatch.set(ref.kind + '/' + ref.id, p);
      applyVehPatch(ref);
    };
    inp.onchange = commit;
    d.append(lab, inp); host.append(d);
  }

  const changed = Object.keys(patch).length;
  const bar = document.createElement('div'); bar.className = 'row'; bar.style.marginTop = '6px';
  const b = document.createElement('button'); b.textContent = 'Reset this row';
  b.disabled = !changed;
  b.onclick = () => { vehPatch.delete(ref.kind + '/' + ref.id); applyVehPatch(ref); };
  const all = document.createElement('button'); all.textContent = 'Reset all vehicles';
  all.onclick = () => { vehPatch.clear(); clearVehicleParams(); draw(); };
  const save = document.createElement('button'); save.textContent = 'Save row';
  save.disabled = !changed;
  save.onclick = () => saveVehicleRow(ref);
  bar.append(b, save, all); host.append(bar);
  const n = document.createElement('div'); n.className = 'dim';
  n.textContent = changed ? changed + ' field(s) changed from the shipping row' : 'unchanged';
  host.append(n);
  if (vehSaveMsg) {
    const m = document.createElement('div'); m.className = 'dim'; m.textContent = vehSaveMsg; host.append(m);
  }
}

// The row as it stands, posted whole. The server derives the filename from it, validates with the
// same validator the bake runs, and rolls the write back if the re-bake refuses it — so a refusal
// here is a message, never a half-written content directory.
async function saveVehicleRow(ref) {
  const base = vehicleParamBase(ref.kind, ref.id) || {};
  const patch = vehPatch.get(ref.kind + '/' + ref.id) || {};
  const doc = { id: ref.id, kind: ref.kind, params: { ...base, ...patch } };
  vehSaveMsg = 'saving…'; draw();
  try {
    const r = await fetch('/api/vehicles', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc }),
    });
    const j = await r.json();
    if (!r.ok) { vehSaveMsg = (j.errors || [r.statusText]).join(' · '); draw(); return; }
    // ⚠ THE PATCH IS KEPT, NOT CLEARED. This page imported the baked module once, so
    // vehicleParamBase still hands back the values that were baked when it loaded. Clearing the
    // patch would show those old numbers under a mesh built from the new ones, which is the tool
    // disagreeing with itself; the fields stay flagged until a reload makes the file the baseline.
    vehSaveMsg = 'saved to content/vehicle_models/' + j.file + ' and re-baked — reload to make it the baseline';
    draw();
  } catch (e) {
    vehSaveMsg = 'save failed: ' + e.message; draw();
  }
}

// ── the readouts ────────────────────────────────────────────────────────────
function row(host, label, value, cls) {
  const d = document.createElement('div');
  d.className = 'row';
  const b = document.createElement('b'); b.textContent = label;
  const v = document.createElement('span'); v.textContent = value; if (cls) v.className = cls;
  d.append(b, v); host.append(d);
}

function fmtErr(m) {
  try {
    const e = shapeLinearityError(m, state.seed);
    if (e == null) return { ok: true, text: 'clean' };
    return { ok: false, text: typeof e === 'number' ? e.toExponential(1) : JSON.stringify(e).slice(0, 120) };
  } catch (err) { return { ok: false, text: err.message }; }
}

function renderSidebar() {
  const m = modelOf(state.key);
  const meta = $('meta'); meta.textContent = '';
  const segs = shapeForModel(m, state.seed);
  row(meta, 'key', state.key);
  row(meta, 'type', m?.type || '?');
  row(meta, 'family', familyOf(state.key, m));
  row(meta, 'palette', m?.pal || '—');
  row(meta, 'segments', segs ? String(segs.length) : 'capture failed', segs ? '' : 'err');
  row(meta, 'spars', segs?.spars ? String(segs.spars.length) : '0');
  if (segs?.length) {
    let top = 0;
    const sc = scale();
    for (const s of segs) top = Math.max(top, s.z1[0] * sc.fh + s.z1[1] * sc.h + s.z1[2]);
    row(meta, 'roof', (top / Math.max(1e-6, sc.h)).toFixed(2) + ' x h');
  }
  const cost = shapeAdornCost(m, state.tier, state.night);
  row(meta, 'adorn cost', cost.grads + ' grads · ' + cost.blurs + ' blurs', cost.grads + cost.blurs > 30 ? 'warn' : '');

  const bake = $('bake'); bake.textContent = '';
  const kept = shapeWireList(m, 9);
  const spars = segs?.spars?.length ?? 0;
  row(bake, 'kept', kept.length + ' of ' + (segs?.length ?? 0) + (spars ? ' mass + ' + spars + ' spar' : ''));
  const ol = document.createElement('ol');
  for (const s of kept) {
    const li = document.createElement('li');
    li.textContent = (s.kind || 'box') + (s.tall ? ' · tall' : '') + (s.front ? ' · front' : '');
    ol.append(li);
  }
  bake.append(ol);

  const checks = $('checks'); checks.textContent = '';
  const warns = shapeConstantWarnings(m, state.seed) || [];
  const lin = fmtErr(m);
  row(checks, 'affine', lin.ok ? 'clean' : lin.text, lin.ok ? '' : 'err');
  row(checks, 'seed variant', shapeIsSeedVariant(m) ? 'yes' : 'no');
  row(checks, 'constant terms', warns.length ? String(warns.length) : 'none', warns.length ? 'warn' : '');
  for (const w of warns.slice(0, 8)) {
    const d = document.createElement('div');
    d.className = 'warn';
    d.textContent = '· ' + (typeof w === 'string' ? w : JSON.stringify(w));
    checks.append(d);
  }
}

// ── selection, and the transform gizmo ──────────────────────────────────────
const HIT_PX = 34;
const AUTH_ZERO = [0, 0, 0];

function segScreenPoints() {
  if (isVehicle(state.key)) return [];
  const doc = editorDocFor(state.key);
  const m = modelOf(state.key);
  if (!doc || !m || !lastCam) return [];
  const { cam, dx, dy } = lastCam;
  const th = Math.atan2(-state.E[0], state.E[1]), ct = Math.cos(th), st = Math.sin(th);
  const sc = scale();
  const V = (p) => (p ? p[0] * sc.fh + p[1] * sc.h + p[2] : 0);
  return m.segs.map((s, i) => {
    const lx = V(s.cx || AUTH_ZERO), ly = V(s.cy || AUTH_ZERO);
    const wx = dx + lx * ct - ly * st, wy = dy + lx * st + ly * ct;
    const p = cam.proj(wx, wy, (V(s.z0) + V(s.z1)) / 2);
    return { i, p };
  }).filter((r) => r.p.f > 0.2);
}

// Screen delta → model-local delta at the depth of the piece you grabbed. Lateral is a
// real perspective divide; forward reuses the same scale, which is an approximation and
// the right one — it makes the drag feel linear, and the field beside it shows the truth.
//
// ⚠ It must undo the ENTRANCE ROTATION. Segment coordinates are model-local and the model
// is turned to face its entrance, so a screen-right drag is only world-right when the
// facing is north. Without the inverse the piece walks off at an angle to the mouse.
function dragToLocal(dsx, dsy, f) {
  const per = f / lastCam.cam.FL;
  const worldSide = dsx * per, worldFwd = dsy * per;
  const hd = state.heading * Math.PI / 180, sh = Math.sin(hd), ch = Math.cos(hd);
  const wx = worldSide * ch + worldFwd * sh, wy = worldSide * sh - worldFwd * ch;
  const th = Math.atan2(-state.E[0], state.E[1]), ct = Math.cos(th), st = Math.sin(th);
  const lx = wx * ct + wy * st, ly = -wx * st + wy * ct;
  const k = BASIS.fh / Math.max(1e-6, scale().fh);
  return [lx * k, ly * k];
}

const snap = (v) => Math.round(v * 100) / 100;

// The three transforms, on the fields the schema actually has. Shift is the vertical
// modifier throughout, which is the one convention worth being consistent about: there is
// no depth cue in this projection, so height can never be a free drag.
function applyTransform(seg, start, dsx, dsy, f, shift) {
  const [dlx, dly] = dragToLocal(dsx, dsy, f);
  const vScale = (BASIS.h / Math.max(1e-6, scale().h)) * (f / lastCam.cam.FL);
  if (state.mode === 'move') {
    if (shift) {
      // Move the piece bodily up or down: both ends together, so its height is unchanged.
      const dz = snap(-dsy * vScale);
      seg.z0 = snap(start.z0 + dz);
      seg.z1 = snap(start.z1 + dz);
    } else {
      seg.cx = snap(start.cx + dlx);
      seg.cy = snap(start.cy + dly);
    }
  } else if (state.mode === 'scale') {
    if (shift) {
      // Grow from the base, which is what a building does.
      seg.z1 = snap(Math.max(start.z0 + 0.02, start.z1 - dsy * vScale));
    } else {
      const k = Math.max(0.05, 1 + dsx / 220);
      if (seg.kind === 'drum') {
        seg.rb = snap(Math.max(0.01, start.rb * k));
        if (start.rt != null) seg.rt = snap(Math.max(0.005, start.rt * k));
      } else {
        seg.hw = snap(Math.max(0.02, start.hw * k));
        if (start.fd != null) seg.fd = snap(Math.max(0.02, start.fd * k));
      }
    }
  } else if (state.mode === 'rotate') {
    // Radians, because that is what draw3DBoxAt's yaw argument is. A drum has no yaw —
    // it is a solid of revolution, so the field would be authored and never read.
    if (seg.kind !== 'drum') seg.yaw = Number((((start.yaw || 0) + dsx / 160)).toFixed(3));
  }
}

function initViewport() {
  const view = $('view');
  let act = null;   // { kind:'orbit'|'pan'|'edit', ... }

  // Where the camera is in SPHERICAL terms about the subject, captured at grab time. An orbit
  // moves on this sphere; a drag that changed eye and distance separately is a crane, not an
  // orbit. See the note on orbitTo below.
  const orbitGrab = (sx, sy, k, locked) => {
    const b = currentBounds();
    const zMid = (b.baseH || 0) + b.height / 2;
    const dz = state.eye - zMid;
    return {
      kind: 'orbit', locked, sx, sy, k, heading: state.heading, zMid,
      radius: Math.max(0.2, Math.hypot(state.dist, dz)),
      elev: Math.atan2(dz, Math.max(0.05, state.dist)),
      // Solved once per grab rather than per frame: the subject does not change size mid-drag,
      // and re-solving it under the mouse would make the floor itself move.
      minDist: MIN_DEPTH,
    };
  };

  const local = (ev) => {
    const r = view.getBoundingClientRect();
    const k = view.width / Math.max(1, r.width);
    return [(ev.clientX - r.left) * k, (ev.clientY - r.top) * k, k];
  };

  view.addEventListener('contextmenu', (ev) => ev.preventDefault());

  view.addEventListener('mousedown', (ev) => {
    const [sx, sy, k] = local(ev);
    // MIDDLE BUTTON ORBITS, which is the convention every 3-D editor has trained people in,
    // and it orbits LOCKED: the model stays pinned at the centre of the picture however far
    // round or up you go. Shift+middle pans, as it does in Blender; the right button pans
    // too, because muscle memory differs and it costs nothing.
    if (ev.button === 1 && !ev.shiftKey) {
      ev.preventDefault();
      act = orbitGrab(sx, sy, k, true);
      view.classList.add('grabbing');
      return;
    }
    if (ev.button === 1 || ev.button === 2) {
      ev.preventDefault();
      act = { kind: 'pan', sx, sy, k, panX: state.panX, panY: state.panY };
      view.classList.add('grabbing');
      return;
    }
    if (ev.button !== 0) return;

    // A hit on a piece begins a transform; empty space begins an orbit. That is the one
    // rule that makes a single mouse button enough for both.
    let best = null;
    for (const { i, p } of segScreenPoints()) {
      const d = Math.hypot(p.sx - sx, p.sy - sy);
      if (d < HIT_PX * k && (!best || d < best.d)) best = { i, d, f: p.f };
    }
    const doc = editorDocFor(state.key);
    if (best && doc) {
      selectedSeg = best.i;
      // One snapshot taken at grab time; the drag's own writes coalesce into that single
      // step, so Ctrl+Z puts the piece back where you picked it up rather than a pixel left.
      pushUndoFor(state.key, 'gizmo');
      const s = doc.segs[best.i];
      act = {
        kind: 'edit', i: best.i, f: best.f, sx, sy, k,
        start: { cx: s.cx || 0, cy: s.cy || 0, z0: s.z0 || 0, z1: s.z1 || 0, hw: s.hw || 0.2, fd: s.fd, rb: s.rb || 0.1, rt: s.rt, yaw: s.yaw || 0 },
      };
      draw();
      return;
    }
    if (best) { selectedSeg = best.i; draw(); return; }   // a code arm: select, cannot edit
    // An empty-space drag orbits the same way the middle button does, locked included. It used
    // to be the unlocked version, which with a real orbit would slide the model off the frame
    // as the camera rose — the thing locking exists to stop.
    act = orbitGrab(sx, sy, k, true);
    view.classList.add('grabbing');
  });

  addEventListener('mousemove', (ev) => {
    if (!act) return;
    const r = view.getBoundingClientRect();
    const sx = (ev.clientX - r.left) * act.k, sy = (ev.clientY - r.top) * act.k;
    const dsx = sx - act.sx, dsy = sy - act.sy;

    if (act.kind === 'orbit') {
      state.heading = (act.heading + dsx * 0.35 + 360000) % 360;
      // ⚠ VERTICAL DRAG MOVES ON THE SPHERE, never up a line. Raising the eye while holding the
      // distance is a CRANE: the camera climbs and the subject stays as far away in plan, so it
      // flattens and slides rather than turning under you. The orbit holds the RADIUS about the
      // subject's own mid-height, and the camera is AIMED with the pitch term — so the arc is
      // free, over the roof and down under the belly, and nothing shears on the way.
      //
      // It stops just short of the poles rather than at them: straight down is a fine picture, but
      // at the pole every heading projects the same one, so a drag through it flips the model end
      // for end under the mouse.
      const elev = Math.max(-POLE, Math.min(POLE, act.elev - dsy * 0.004));
      state.dist = Math.max(act.minDist, Math.abs(act.radius * Math.cos(elev)));
      // ⚠ The eye may go BELOW the ground here, and that is right for a model viewer — you look up
      // at a building from under the pavement. It is the one place this camera is deliberately not
      // the sim's, where the floor under the eye height is what stops the terrain collapsing.
      state.eye = act.zMid + act.radius * Math.sin(elev);
      aimAtModel();
      draw();
      return;
    }
    if (act.kind === 'pan') {
      state.panX = act.panX - dsx * 0.006 * state.dist;
      state.panY = act.panY + dsy;
      draw();
      return;
    }
    const doc = editorDocFor(state.key);
    if (!doc) return;
    applyTransform(doc.segs[act.i], act.start, dsx, dsy, act.f, ev.shiftKey);
    markDirty();
    invalidateEdit(state.key);
    draw();
  });

  addEventListener('mouseup', () => { act = null; view.classList.remove('grabbing'); });
  // The projected pieces and the live drag, for driving this viewport from a console or a
  // test. It is also the thing that explains a hit test which "does not work": in a hidden
  // or zero-sized pane the canvas collapses to 1x1 and every point projects to the origin,
  // which looks exactly like broken selection code and is not.
  window.__msDebug = () => ({
    mode: state.mode,
    // The camera as three numbers, so an orbit can be checked as arithmetic rather than
    // by eye: a drag that holds the radius is an orbit, one that does not is a crane.
    cam: { heading: state.heading, dist: state.dist, eye: state.eye, pitch: state.pitch, panY: state.panY },
    act: act && { kind: act.kind, i: act.i },
    hasDoc: !!editorDocFor(state.key),
    hasCam: !!lastCam,
    canvas: [view.width, view.height],
    pts: segScreenPoints().map((r) => ({ i: r.i, sx: Math.round(r.p.sx), sy: Math.round(r.p.sy) })),
  });

  view.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    // Multiplicative, so a step feels the same close up and far away.
    state.dist = Math.max(1.2, Math.min(90, state.dist * (ev.deltaY > 0 ? 1.12 : 1 / 1.12)));
    draw();
  }, { passive: false });
}

function paintSelection() {
  if (selectedSeg < 0 || !lastCam) return;
  const hit = segScreenPoints().find((r) => r.i === selectedSeg);
  if (!hit) return;
  const ctx = $('view').getContext('2d');
  ctx.save();
  ctx.strokeStyle = '#6fd3ff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(hit.p.sx, hit.p.sy, 14, 0, 7); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(hit.p.sx - 22, hit.p.sy); ctx.lineTo(hit.p.sx - 16, hit.p.sy);
  ctx.moveTo(hit.p.sx + 16, hit.p.sy); ctx.lineTo(hit.p.sx + 22, hit.p.sy);
  ctx.stroke();
  ctx.restore();
}

// ── the difference view ─────────────────────────────────────────────────────
// modeldiff.mjs compares DRAWING OPERATIONS, because a pixel diff in node needs a native
// canvas. That over-reports by construction — two paths in a different order make the same
// picture and a different trace — so this is where the question is actually settled, in
// real pixels, amplified because an unamplified delta of four levels is invisible on a
// dark building and that is exactly the size of mistake a port makes.
const DIFF_GAIN = 6, DIFF_W = 300, DIFF_H = 200;

function diffCanvases() {
  const host = $('diffimgs');
  if (host.childElementCount !== 3) {
    host.textContent = '';
    for (const cap of ['this', 'that', 'diff x' + DIFF_GAIN]) {
      const fig = document.createElement('figure');
      const c = document.createElement('canvas'); c.width = DIFF_W; c.height = DIFF_H;
      const f = document.createElement('figcaption'); f.textContent = cap;
      fig.append(c, f); host.append(fig);
    }
  }
  return [...host.querySelectorAll('canvas')];
}

function renderDiff() {
  const num = $('diffnum'); num.textContent = '';
  const other = modelOf($('cmp').value);
  if (!other) { $('diffimgs').textContent = ''; return; }
  const [ca, cb, cd] = diffCanvases();
  const opts = { ...previewOpts(), wire: false };
  renderModelPreview(ca, opts);
  renderModelPreview(cb, { ...opts, m: other });
  const A = ca.getContext('2d').getImageData(0, 0, DIFF_W, DIFF_H);
  const B = cb.getContext('2d').getImageData(0, 0, DIFF_W, DIFF_H);
  const D = cd.getContext('2d').createImageData(DIFF_W, DIFF_H);
  let differing = 0, worst = 0, total = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    let m = 0;
    for (let k = 0; k < 3; k++) {
      const d = Math.abs(A.data[i + k] - B.data[i + k]);
      if (d > m) m = d;
      D.data[i + k] = Math.min(255, d * DIFF_GAIN);
      total += d;
    }
    D.data[i + 3] = 255;
    if (m) { differing++; if (m > worst) worst = m; }
  }
  cd.getContext('2d').putImageData(D, 0, 0);
  const px = DIFF_W * DIFF_H;
  row(num, 'pixels differing', (100 * differing / px).toFixed(2) + '%', differing ? 'warn' : '');
  row(num, 'worst channel', String(worst), worst > 24 ? 'warn' : '');
  row(num, 'mean delta', (total / (px * 3)).toFixed(3));
  if (!differing) num.append(Object.assign(document.createElement('div'), { textContent: 'identical at this camera' }));
}

function fillCompare() {
  const sel = $('cmp'), keep = sel.value;
  sel.textContent = '';
  const none = document.createElement('option'); none.value = ''; none.textContent = '— compare with —';
  sel.append(none);
  for (const r of MODELS) {
    if (r.key === state.key) continue;
    const o = document.createElement('option'); o.value = r.key; o.textContent = r.key;
    sel.append(o);
  }
  sel.value = keep;
}

// ── controls ────────────────────────────────────────────────────────────────
const bindRange = (id, key) => {
  const el = $(id);
  if (!el) return;
  el.value = state[key];
  el.oninput = () => { state[key] = Number(el.value); draw(); };
};
bindRange('seed', 'seed'); bindRange('night', 'night');
{
  const el = $('floors'); el.value = state.floors;
  el.oninput = () => { state.floors = Number(el.value); preset(state.preset); };
}
$('facing').onchange = () => { state.E = $('facing').value.split(',').map(Number); draw(); };
$('cmp').onchange = () => renderDiff();
$('wire').onclick = () => { state.wire = !state.wire; $('wire').classList.toggle('on', state.wire); draw(); };
// The spike, behind a switch that says what it is. Absent entirely where WebGL2 is not there,
// rather than present and broken.
function setGl(on) {
  state.gl = !!on && glAvailable();
  $('gl').classList.toggle('on', state.gl);
  if (!state.gl) glHide();
  draw();
}
$('gl').onclick = () => setGl(!state.gl);
if (!glAvailable()) { $('gl').disabled = true; $('gl').title = 'this browser has no WebGL2'; }

function setMode(mode) {
  state.mode = mode;
  refreshToolbox();
  for (const m of ['move', 'scale', 'rotate']) $('mode-' + m).classList.toggle('on', m === mode);
  draw();
}
$('mode-move').onclick = () => setMode('move');
$('mode-scale').onclick = () => setMode('scale');
$('mode-rotate').onclick = () => setMode('rotate');

// THE TWO PRESETS, and why the second is not a nicety. ADORN_NEAR exists for a truck cab
// at eye height 0 and a cockpit almost never sees it — so authoring only from a cockpit is
// exactly how near-tier detail ships broken. The cab preset is the only way to look at it.
function preset(which) {
  if (isVehicle(state.key)) {
    // ⚠ A VEHICLE IS SCALED UP, NOT APPROACHED. These meshes are authored to read as a
    // contact seen from an aeroplane — a rig stands about 0.05 tiles tall — so no camera
    // distance makes one fill a screen; the projection's own near clamp stops you first.
    // The preview therefore picks a sizeMul that gives the model a sensible world size and
    // frames THAT. Its real size is still what the sim uses; only the preview is scaled.
    const v = entryOf(state.key).vehicle;
    const b = vehicleBounds(v.cls, !!v.armed, v.variant);
    state.vehSizeMul = 1.2 / b.height;
    // ⚠ Padded, because the PAINTED craft is bigger than its face list: the prop disc, the
    // lamp glows and the ground shadow are all drawn outside the vertices vehicleBounds can
    // see. Measured rather than guessed — at an unpadded fit six of ten classes spilled past
    // the frame while the three smallest sat correctly at ~0.7.
    const VEH_PAINT_PAD = 1.45;
    const f = frameAt({ halfW: b.halfW * state.vehSizeMul * VEH_PAINT_PAD, height: 1.2 * VEH_PAINT_PAD, baseH: b.baseH * state.vehSizeMul }, which);
    state.dist = f.dist; state.eye = f.eye; state.tier = f.tier;
    state.preset = which; state.panX = 0; state.panY = 0;
    aimAtModel();
    $('preset-cab').classList.toggle('on', which === 'cab');
    $('preset-cockpit').classList.toggle('on', which !== 'cab');
    draw();
    return;
  }
  const sc = scale();
  const f = frameAt(buildingBounds(modelOf(state.key)), which);
  $('scaleread').textContent = 'fh ' + sc.fh.toFixed(3) + ' · h ' + sc.h.toFixed(3);
  state.dist = Math.round(f.dist * 2) / 2;
  state.eye = Math.round(f.eye * 10) / 10;
  state.tier = f.tier;
  state.preset = which;
  state.panX = 0; state.panY = 0;
  aimAtModel();
  $('preset-cab').classList.toggle('on', which === 'cab');
  $('preset-cockpit').classList.toggle('on', which !== 'cab');
  draw();
}
$('preset-cockpit').onclick = () => preset('cockpit');
$('preset-cab').onclick = () => preset('cab');
$('frame').onclick = () => preset(state.preset);

$('open').onclick = () => { renderBrowser($('search').value); $('browserdlg').showModal(); $('search').select(); };
$('bclose').onclick = () => $('browserdlg').close();
$('search').oninput = () => renderBrowser($('search').value);
$('tools-open').onclick = () => openToolPicker();
// The palette is a live panel, so it has to be told when the thing it describes changes: a
// different model can make the add-mass tools legal or not, and a mode change lights a button.
initToolbox(() => {});
// The picker reaches back for these three rather than importing app state, which would be
// a module cycle: it needs the live mode, a way to set it, and a way to repaint after adding.
window.__msMode = () => state.mode;
window.__msSetMode = (m) => setMode(m);
window.__msRedraw = () => { invalidateEdit(state.key); draw(); };
$('palclose').onclick = () => $('paldlg').close();
$('palsearch').oninput = () => renderPalette($('palsearch').value);

// ── SPIN ────────────────────────────────────────────────────────────────────
// Two rules, both learned the hard way.
//
// ⚠ THE HEADING COMES FROM THE CLOCK, NOT FROM A COUNTER. `heading += 0.6` per frame means the
// turntable's speed is whatever frame rate the model happens to render at — a shopfront spins
// several times faster than Halcyon, and a heavy model creeps. Derived from elapsed time it turns
// at 36°/s whatever the machine is doing, and a dropped frame is a skipped step rather than a slow
// one.
//
// ⚠ AND IT DOES NOT RIDE requestAnimationFrame ALONE. rAF stops being delivered whenever the page
// is not being composited — a background tab, an occluded window, a headless check — and the spin
// then stops dead with the button still lit, which is indistinguishable from it being broken. So a
// timer runs beside it and whichever arrives first advances the frame; `busy` keeps them from
// painting the same model twice over.
let spinTimer = 0, spinRaf = 0, spinBusy = false, spinFrom = 0, spinAt = 0;
const SPIN_DPS = 36;
function spinStep() {
  if (!state.spin || spinBusy) return;
  spinBusy = true;
  try {
    state.heading = (spinFrom + (performance.now() - spinAt) / 1000 * SPIN_DPS) % 360;
    paintViewport();
  } finally {
    spinBusy = false;
  }
  spinRaf = requestAnimationFrame(spinStep);
}
$('spin').onclick = () => {
  state.spin = !state.spin;
  $('spin').classList.toggle('on', state.spin);
  cancelAnimationFrame(spinRaf);
  clearInterval(spinTimer);
  if (!state.spin) return;
  spinFrom = state.heading; spinAt = performance.now();
  spinTimer = setInterval(spinStep, 33);
  spinRaf = requestAnimationFrame(spinStep);
};

// Keyboard, on the conventions a 3-D editor already trained everyone in. Ignored while a
// field has focus, or typing a palette name would rotate the building.
addEventListener('keydown', (ev) => {
  const t = ev.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  const doc = editorDocFor(state.key);
  const k = ev.key.toLowerCase();
  // Undo / redo, on the shortcuts everyone already has in their fingers.
  if ((ev.ctrlKey || ev.metaKey) && k === 'z') {
    ev.preventDefault();
    if (ev.shiftKey ? redo() : undo()) { invalidateEdit(state.key); draw(); }
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && k === 'y') {
    ev.preventDefault();
    if (redo()) { invalidateEdit(state.key); draw(); }
    return;
  }
  if (ev.ctrlKey || ev.metaKey) return;   // leave every other browser shortcut alone
  if (k === 'g') setMode('move');
  else if (k === 's') setMode('scale');
  else if (k === 'r') setMode('rotate');
  else if (k === 'f') preset(state.preset);
  else if (k === 'o') { ev.preventDefault(); $('open').click(); }
  else if (k === 't') { ev.preventDefault(); toggleToolbox(); }
  else if (k === 'g' && !ev.shiftKey) { ev.preventDefault(); setGl(!state.gl); }
  else if (k === 'escape') { selectedSeg = -1; draw(); }
  else if ((k === 'delete' || k === 'backspace') && doc && selectedSeg >= 0) {
    ev.preventDefault();
    pushUndoFor(state.key, 'delete');
    doc.segs.splice(selectedSeg, 1);
    selectedSeg = -1; markDirty(); invalidateEdit(state.key); draw();
  } else if (k === 'd' && doc && selectedSeg >= 0) {
    pushUndoFor(state.key, 'duplicate');
    doc.segs.splice(selectedSeg + 1, 0, JSON.parse(JSON.stringify(doc.segs[selectedSeg])));
    selectedSeg += 1; markDirty(); invalidateEdit(state.key); draw();
  } else return;
});

// MODELS is a snapshot taken at load, so a model created since then is editable and
// previewable but absent from the browser — which reads as it having vanished.
window.__msRegister = (key) => {
  if (MODELS.some((r) => r.key === key)) return;
  MODELS.push({ key, m: editorRecordFor(key) });
  MODELS.sort((a, b) => a.key.localeCompare(b.key));
};
window.__msReselect = (key) => { window.__msRegister(key); select(key); };
// The seed the viewport is showing, so a fork captures the arm at the shape you are looking at
// rather than at a default the tool never draws.
window.__msSeed = () => state.seed;
window.__msUnregister = (key) => {
  const i = MODELS.findIndex((r) => r.key === key);
  if (i >= 0) MODELS.splice(i, 1);
  invalidateEdit(key);
  if (state.key === key) select(MODELS[0]?.key || null);
  else draw();
};
window.__msSelect = (i) => { selectedSeg = i; draw(); };
window.__msSelected = () => selectedSeg;
window.__msModel = (key) => MODELS.find((r) => r.key === key)?.m || null;

addEventListener('resize', () => { if (!state.spin) draw(); });

initViewport();
$('modelname').textContent = bare(state.key);
fillCompare();
preset('cockpit');
// The editor loads its documents after the first paint, so the inspector is usable
// immediately and a server that is not answering degrades to read-only rather than blank.
initEditor({ state, onChange: draw }).then(() => { invalidateEdit(state.key); draw(); })
  .catch((e) => { $('esave').className = 'err'; $('esave').textContent = 'no write path: ' + e.message; });

// The palette is filled LAST, after the window hooks it reads (__msMode) are assigned above.
// Rendering it earlier leaves the active tool unlit until the first mode change.
refreshToolbox();

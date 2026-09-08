// MODELSHOP — the client.
//
// It imports the REAL renderer. Nothing here draws a building, computes a camera, or
// knows what a segment is — every picture on the page comes out of renderModelPreview(),
// a named entry into windshield.js's own drawTypeModel. That is the whole reason the tool
// is worth trusting: there is no second renderer to disagree with the sim.
//
// ⚠ Quoting rule, from CLAUDE.md: inside a template literal, quote identifiers with
// 'single quotes', never backticks. Most markup here is built through the DOM instead.
import {
  shapeModelRegistry, renderModelPreview, shapeForModel, shapeWireList,
  shapeConstantWarnings, shapeAdornCost, shapeLinearityError, shapeIsSeedVariant,
  ADORN_RICH, ADORN_NEAR, buildingScaleFor,
  renderVehiclePreview, VEHICLE_CLASSES, TRUCK_VARIANTS, vehicleBounds, previewFit,
} from '/client/game/js/panels/windshield.js';
import {
  initEditor, renderEditor, editorRecordFor, editorDocFor, markDirty, renderPalette,
  pushUndoFor, undo, redo, openToolPicker,
} from './editor.js';

const $ = (id) => document.getElementById(id);

// The AUTHORING BASIS — the pair captureRawPass uses, so a number an author types is the
// number the capture solves at.
const BASIS = { fh: 0.4, h: 1 };
const SCALES = [[1, 1], [2, 1], [1, 2], [2, 3]];

// Buildings AND vehicles. They are two different renderers — a building is a drawTypeModel
// arm, a vehicle is a face list from aircraft3d — so an entry carries which one it is and
// the viewport branches once. Vehicles are read-only: their meshes are parametric code with
// no capture and no authored format, so there is nothing for the editor to write.
const VEHICLES = [
  ...VEHICLE_CLASSES.filter((c) => c !== 'truck').map((cls) => ({ key: 'vehicle:' + cls, vehicle: { cls, variant: '' }, m: { type: cls } })),
  ...TRUCK_VARIANTS.map((v) => ({ key: 'vehicle:truck/' + v, vehicle: { cls: 'truck', variant: v }, m: { type: 'truck ' + v } })),
];
const MODELS = [...shapeModelRegistry(), ...VEHICLES];
const entryOf = (key) => MODELS.find((r) => r.key === key) || null;
const isVehicle = (key) => !!entryOf(key)?.vehicle;
let selectedSeg = -1;
let lastCam = null;

const state = {
  key: MODELS[0]?.key || null,
  heading: 0, dist: 9, eye: 1.4, panX: 0, panY: 0, vehSizeMul: 1,
  floors: 6, seed: 3, night: 0,
  E: [0, 1], tier: ADORN_RICH, wire: false, spin: false, preset: 'cockpit',
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
    const b = vehicleBounds(v.cls, false, v.variant);
    const sm = state.vehSizeMul || 1;
    return { halfW: b.halfW * sm, height: b.height * sm, baseH: b.baseH * sm };
  }
  return buildingBounds(modelOf(state.key));
}

// ── LOCKED ORBIT ────────────────────────────────────────────────────────────
// There is no pitch in this projection: arcing the eye up moves the picture DOWN the
// screen, because `sy = horizonY + depth · (EH − wz) / f`. So an orbit that only changed
// the eye would walk the model off the bottom of the frame as you rose — which is not an
// orbit, it is a camera drifting away from its subject.
//
// Locking it is one line of algebra rather than a new camera. Solve the horizon shift that
// keeps the model's own mid-height at the centre of the canvas:
//
//   H/2 = (H·0.42 + panY) + depth·(EH − zMid)/dist        with depth = H·0.55
//   panY = H·0.08 − H·0.55·(EH − zMid)/dist
//
// so the subject stays pinned however far round or up you go.
function lockCentre() {
  const view = $('view');
  const H = Math.max(1, view.height);
  const b = currentBounds();
  const zMid = (b.baseH || 0) + b.height / 2;
  state.panY = H * 0.08 - H * 0.55 * (state.eye - zMid) / Math.max(0.05, state.dist);
}

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
    heading: state.heading, dist: state.dist, eyeH: state.eye,
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
    if (isVehicle(state.key)) {
      const v = entryOf(state.key).vehicle;
      lastCam = renderVehiclePreview(view, {
        ...v, night: state.night, heading: state.heading, dist: state.dist,
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
  $('hud').textContent = 'middle-drag to orbit · shift+middle or right-drag to pan · wheel to zoom — vehicles are read-only';
  const meta = $('meta'); meta.textContent = '';
  row(meta, 'key', state.key);
  row(meta, 'class', v.cls);
  if (v.variant) row(meta, 'variant', v.variant);
  row(meta, 'family', familyOf(state.key, null));
  row(meta, 'mesh', 'aircraft3d.js (parametric code)');
  for (const id of ['scales', 'bake', 'checks', 'diffimgs', 'diffnum']) $(id).textContent = '';
  const ed = $('editor'); ed.textContent = '';
  const note = document.createElement('div'); note.className = 'dim';
  note.textContent = 'Vehicle meshes are parametric code in aircraft3d.js — there is no capture and no authored format for them, so there is nothing here to edit. Buildings are editable.';
  ed.append(note);
  $('scaleread').textContent = '';
}

function drawHud() {
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
      act = { kind: 'orbit', locked: true, sx, sy, k, heading: state.heading, eye: state.eye };
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
    act = { kind: 'orbit', sx, sy, k, heading: state.heading, eye: state.eye };
    view.classList.add('grabbing');
  });

  addEventListener('mousemove', (ev) => {
    if (!act) return;
    const r = view.getBoundingClientRect();
    const sx = (ev.clientX - r.left) * act.k, sy = (ev.clientY - r.top) * act.k;
    const dsx = sx - act.sx, dsy = sy - act.sy;

    if (act.kind === 'orbit') {
      state.heading = (act.heading + dsx * 0.35 + 360000) % 360;
      // Vertical drag arcs the eye. There is no pitch term in this projection — see the
      // README — so raising the eye IS looking down, and clamping at 0 keeps the camera
      // from going under the ground it is standing on.
      state.eye = Math.max(0, act.eye - dsy * 0.02);
      // A LOCKED orbit keeps the subject pinned: the horizon shift is re-solved every frame,
      // so raising the eye circles the model instead of sliding it off the bottom.
      if (act.locked) lockCentre();
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

function setMode(mode) {
  state.mode = mode;
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
    const b = vehicleBounds(v.cls, false, v.variant);
    state.vehSizeMul = 1.2 / b.height;
    // ⚠ Padded, because the PAINTED craft is bigger than its face list: the prop disc, the
    // lamp glows and the ground shadow are all drawn outside the vertices vehicleBounds can
    // see. Measured rather than guessed — at an unpadded fit six of ten classes spilled past
    // the frame while the three smallest sat correctly at ~0.7.
    const VEH_PAINT_PAD = 1.45;
    const f = frameAt({ halfW: b.halfW * state.vehSizeMul * VEH_PAINT_PAD, height: 1.2 * VEH_PAINT_PAD, baseH: b.baseH * state.vehSizeMul }, which);
    state.dist = f.dist; state.eye = f.eye; state.tier = f.tier;
    state.preset = which; state.panX = 0; state.panY = 0;
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
$('toolclose').onclick = () => $('tooldlg').close();
// The picker reaches back for these three rather than importing app state, which would be
// a module cycle: it needs the live mode, a way to set it, and a way to repaint after adding.
window.__msMode = () => state.mode;
window.__msSetMode = (m) => setMode(m);
window.__msRedraw = () => { invalidateEdit(state.key); draw(); };
$('palclose').onclick = () => $('paldlg').close();
$('palsearch').oninput = () => renderPalette($('palsearch').value);

let spinRaf = 0;
$('spin').onclick = () => {
  state.spin = !state.spin;
  $('spin').classList.toggle('on', state.spin);
  if (!state.spin) { cancelAnimationFrame(spinRaf); return; }
  const step = () => {
    if (!state.spin) return;
    state.heading = (state.heading + 0.6) % 360;
    paintViewport();
    spinRaf = requestAnimationFrame(step);
  };
  spinRaf = requestAnimationFrame(step);
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
  else if (k === 't') { ev.preventDefault(); openToolPicker(); }
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

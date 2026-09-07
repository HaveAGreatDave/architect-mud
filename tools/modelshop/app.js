// MODELSHOP — the client. Phase 1: the inspector.
//
// It imports the REAL renderer. Nothing in this file draws a building, computes a
// camera, or knows what a segment is — every picture on the page comes out of
// renderModelPreview(), which is a named entry into windshield.js's own
// drawTypeModel. That is deliberate and is the whole reason the tool is trustworthy:
// there is no second renderer to disagree with the sim.
//
// ⚠ Quoting rule, from CLAUDE.md: inside a template literal, quote identifiers with
// 'single quotes', never backticks. A backtick in a comment inside a template string
// ends the string mid-sentence and takes the whole client down with it.
import {
  shapeModelRegistry, renderModelPreview, shapeForModel, shapeWireList,
  shapeConstantWarnings, shapeAdornCost, shapeLinearityError, shapeIsSeedVariant,
  ADORN_RICH, ADORN_NEAR,
} from '/client/game/js/panels/windshield.js';
import { initEditor, renderEditor, editorRecordFor, editorDocFor, markDirty } from './editor.js';

const $ = (id) => document.getElementById(id);

// The AUTHORING BASIS. The sliders read in tile units at this scale, which is the
// same pair captureRawPass uses, so what you set here is what the capture solves at.
const BASIS = { fh: 0.4, h: 1 };
// The three scales the affine decomposition is solved from, plus the fourth it is
// VERIFIED against — the strip renders all four, because seeing the model at a scale
// the solver never saw is what "affine in fh and h" actually means.
const SCALES = [[1, 1], [2, 1], [1, 2], [2, 3]];

const MODELS = shapeModelRegistry();
let selectedSeg = -1;
const state = {
  key: MODELS[0]?.key || null,
  heading: 0, dist: 9, eye: 1.4, fh: 0.4, h: 1, seed: 3, night: 0,
  E: [0, 1], tier: ADORN_RICH, wire: false, spin: false, preset: 'cockpit',
};

const editCache = new Map();   // key → the record compiled from the CURRENT doc, one per edit
export function invalidateEdit(key) { editCache.delete(key); }
const modelOf = (key) => {
  if (!editCache.has(key)) editCache.set(key, editorRecordFor(key));
  return editCache.get(key) || MODELS.find((r) => r.key === key)?.m || null;
};

// ── FRAMING IS DERIVED FROM THE MODEL, NOT SET BY HAND ──────────────────────
// A shopfront is 0.8 tiles tall and Halcyon is 2.9, so one fixed distance either
// buries the shop in the bottom of the frame or walks the tower out of the top —
// and an author would spend the session dragging two sliders back to sensible
// before looking at anything. The roof comes out of the capture that is already
// running for the readouts, so this costs nothing.
function roofOf(m, fh, h) {
  const segs = shapeForModel(m, state.seed);
  if (!segs || !segs.length) return h;
  let top = 0;
  for (const s of segs) top = Math.max(top, s.z1[0] * fh + s.z1[1] * h + s.z1[2]);
  return Math.max(0.2, top);
}

// The cab is a driver at a kerb: close, eye almost on the ground, near tier on.
// The cockpit stands back far enough to hold the whole building and sits at about
// half its height, which is the angle a pilot on approach actually gets.
function frameAt(top, which) {
  if (which === 'cab') return { dist: Math.max(1.8, top * 0.5 + 1.1), eye: 0.25, tier: ADORN_NEAR };
  return { dist: Math.max(3.2, top * 1.25 + 2), eye: Math.max(0.8, top * 0.42), tier: ADORN_RICH };
}
const frameFor = (which) => frameAt(roofOf(modelOf(state.key), state.fh, state.h), which);

// ── the model list ──────────────────────────────────────────────────────────
function renderList(filter) {
  const q = (filter || '').trim().toLowerCase();
  const rows = MODELS.filter((r) => !q || r.key.toLowerCase().includes(q) || String(r.m?.type || '').toLowerCase().includes(q));
  $('count').textContent = rows.length === MODELS.length ? String(MODELS.length) : rows.length + '/' + MODELS.length;
  const ul = $('list');
  ul.textContent = '';
  for (const r of rows) {
    const li = document.createElement('li');
    li.className = r.key === state.key ? 'on' : '';
    const name = document.createElement('div');
    name.textContent = r.key.replace(/^(named|type):/, '');
    const kind = document.createElement('div');
    kind.className = 'k';
    kind.textContent = (r.key.startsWith('named:') ? 'named · ' : 'type · ') + (r.m?.type || '?');
    li.append(name, kind);
    li.onclick = () => { state.key = r.key; renderList($('search').value); fillCompare(); preset(state.preset); };
    ul.append(li);
  }
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
    m: modelOf(state.key), name: (state.key || '').replace(/^(named|type):/, '').toUpperCase(),
    seed: state.seed, fh: state.fh, h: state.h, night: state.night, E: state.E,
    heading: state.heading, dist: state.dist, eyeH: state.eye,
    tier: state.tier, wire: state.wire,
    ...over,
  };
}

function draw() {
  const m = modelOf(state.key);
  if (!m) return;
  const view = $('view');
  sizeCanvas(view);
  try {
    lastCam = renderModelPreview(view, previewOpts());
    paintSelection();
  } catch (e) {
    const ctx = view.getContext('2d');
    ctx.fillStyle = '#2a0f10'; ctx.fillRect(0, 0, view.width, view.height);
    ctx.fillStyle = '#ff7b72'; ctx.font = '16px monospace';
    ctx.fillText('threw: ' + e.message, 20, 40);
  }
  drawScales();
  renderSidebar();
  renderDiff();
  renderEditor($('editor'), state.key, () => { invalidateEdit(state.key); draw(); });
}

// The strip. Distance scales with the model so a 3x-tall building does not walk out
// of frame — the point of the strip is the SHAPE at each scale, not the framing.
function drawScales() {
  const host = $('scales');
  if (host.childElementCount !== SCALES.length) {
    host.textContent = '';
    for (const [sf, sh] of SCALES) {
      const fig = document.createElement('figure');
      const c = document.createElement('canvas');
      c.width = 280; c.height = 190;
      const cap = document.createElement('figcaption');
      cap.textContent = 'fh x' + sf + '  h x' + sh + (sf === 2 && sh === 3 ? '  (verify)' : '');
      fig.append(c, cap);
      host.append(fig);
    }
  }
  SCALES.forEach(([sf, sh], i) => {
    const c = host.children[i].querySelector('canvas');
    try {
      renderModelPreview(c, previewOpts({
        fh: BASIS.fh * sf, h: BASIS.h * sh,
        ...(() => { const f = frameAt(roofOf(modelOf(state.key), BASIS.fh * sf, BASIS.h * sh), state.preset); return { dist: f.dist, eyeH: f.eye }; })(),
        wire: false,
      }));
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

function renderSidebar() {
  const m = modelOf(state.key);
  const meta = $('meta'); meta.textContent = '';
  const segs = shapeForModel(m, state.seed);
  row(meta, 'key', state.key);
  row(meta, 'type', m?.type || '?');
  row(meta, 'palette', m?.pal || '—');
  row(meta, 'segments', segs ? String(segs.length) : 'capture failed', segs ? '' : 'err');
  row(meta, 'spars', segs?.spars ? String(segs.spars.length) : '0');
  if (segs?.length) {
    // Roof height in the units an author thinks in: multiples of the storey stack.
    let top = 0;
    for (const s of segs) top = Math.max(top, s.z1[0] * state.fh + s.z1[1] * state.h + s.z1[2]);
    row(meta, 'roof', (top / Math.max(1e-6, state.h)).toFixed(2) + ' x h');
  }
  const cost = shapeAdornCost(m, state.tier, state.night);
  row(meta, 'adorn cost', cost.grads + ' grads · ' + cost.blurs + ' blurs',
    cost.grads + cost.blurs > 30 ? 'warn' : '');

  // What the BAKE keeps — the nine segments the cold open flies past. Only
  // discoverable today by running shapes:bake and reading a diff.
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

// shapeLinearityError answers with null when the decomposition reproduces the model at
// a scale it never saw — which is the ordinary case, and printing the word 'null' for
// it makes a passing check look like a broken readout.
function fmtErr(m) {
  try {
    const e = shapeLinearityError(m, state.seed);
    if (e == null) return { ok: true, text: 'clean' };
    return { ok: false, text: typeof e === 'number' ? e.toExponential(1) : JSON.stringify(e).slice(0, 120) };
  } catch (err) { return { ok: false, text: err.message }; }
}

// ── THE VIEWPORT GIZMO — click a segment, drag it on the ground ─────────────
//
// Two jobs, and the first is the one that earns its place: CLICKING A SEGMENT IN THE
// PICTURE SELECTS ITS CARD, and selecting a card highlights it in the picture. A model is
// a list of numbered boxes in a form and a building on screen, and without this you are
// counting cards to work out which one is the awning.
//
// Dragging moves a segment in the GROUND PLANE only. Size, height and yaw stay in the
// numeric form deliberately: a perspective view with no depth cue makes those a guess, and
// the fields are exact. So the drag is for roughing out where a piece sits, and the numbers
// remain the truth — which is also why the form updates live as you drag.
//
// ⚠ The drag must undo the ENTRANCE ROTATION. Segment coordinates are model-local and the
// model is turned to face its entrance, so a screen-right drag is only world-right when the
// facing is north. Without the inverse rotation the piece walks off at an angle to the
// mouse, which reads as the tool being broken rather than as a missing transform.
let lastCam = null;   // the camera the viewport was last painted with — the gizmo's frame
const HIT_PX = 34;

function segScreenPoints() {
  const doc = editorDocFor(state.key);
  const m = modelOf(state.key);
  if (!doc || !m || !lastCam) return [];
  const { cam, dx, dy } = lastCam;
  const th = Math.atan2(-state.E[0], state.E[1]), ct = Math.cos(th), st = Math.sin(th);
  const V = (p) => (p ? p[0] * state.fh + p[1] * state.h + p[2] : 0);
  return m.segs.map((s, i) => {
    const lx = V(s.cx), ly = V(s.cy);
    const wx = dx + lx * ct - ly * st, wy = dy + lx * st + ly * ct;
    const p = cam.proj(wx, wy, (V(s.z0) + V(s.z1)) / 2);
    return { i, p };
  }).filter((r) => r.p.f > 0.2);
}

// Screen delta → model-local delta, at the depth of the piece you grabbed. Lateral is exact
// (a perspective divide); forward reuses the same scale, which is an approximation and the
// right one — it makes the drag feel linear, and the field beside it shows the real number.
function dragToLocal(dsx, dsy, f) {
  const per = f / lastCam.cam.FL;
  const worldSide = dsx * per, worldFwd = dsy * per;
  const hd = state.heading * Math.PI / 180, sh = Math.sin(hd), ch = Math.cos(hd);
  const wx = worldSide * ch + worldFwd * sh, wy = worldSide * sh - worldFwd * ch;
  const th = Math.atan2(-state.E[0], state.E[1]), ct = Math.cos(th), st = Math.sin(th);
  // Inverse of the model-local → world rotation above.
  const lx = wx * ct + wy * st, ly = -wx * st + wy * ct;
  // …and back out of world tiles into the AUTHORED basis, so dragging at one fh writes the
  // same number dragging at another would.
  const k = (BASIS.fh / Math.max(1e-6, state.fh));
  return [lx * k, ly * k];
}

function initGizmo() {
  const view = $('view');
  let drag = null;
  view.addEventListener('mousedown', (ev) => {
    const r = view.getBoundingClientRect();
    const scale = view.width / Math.max(1, r.width);
    const sx = (ev.clientX - r.left) * scale, sy = (ev.clientY - r.top) * scale;
    let best = null;
    for (const { i, p } of segScreenPoints()) {
      const d = Math.hypot(p.sx - sx, p.sy - sy);
      if (d < HIT_PX * scale && (!best || d < best.d)) best = { i, d, f: p.f };
    }
    if (!best) return;
    selectedSeg = best.i;
    const doc = editorDocFor(state.key);
    drag = doc ? { i: best.i, f: best.f, sx, sy, scale, cx: doc.segs[best.i].cx || 0, cy: doc.segs[best.i].cy || 0 } : null;
    draw();
  });
  addEventListener('mousemove', (ev) => {
    if (!drag) return;
    const r = view.getBoundingClientRect();
    const sx = (ev.clientX - r.left) * drag.scale, sy = (ev.clientY - r.top) * drag.scale;
    const [dlx, dly] = dragToLocal(sx - drag.sx, sy - drag.sy, drag.f);
    const doc = editorDocFor(state.key);
    if (!doc) return;
    // Snap to a hundredth of a tile, which is finer than anything visible and coarse enough
    // that a number written by a drag is still a number a person would have typed.
    const snap = (v) => Math.round(v * 100) / 100;
    doc.segs[drag.i].cx = snap(drag.cx + dlx);
    doc.segs[drag.i].cy = snap(drag.cy + dly);
    markDirty();
    invalidateEdit(state.key);
    draw();
  });
  addEventListener('mouseup', () => { drag = null; });
}

// The selected segment, stroked over the render so the picture and the form agree about
// which piece is which.
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

// ── THE DIFFERENCE VIEW — the half that has to be real pixels ───────────────
//
// scripts/shapes/modeldiff.mjs answers "is this the same picture?" by comparing DRAWING
// OPERATIONS, because a pixel comparison in node needs a native canvas dependency and a
// build toolchain in CI. That trade is right for a push gate and it over-reports by
// construction: two paths drawn in a different order make the same picture and a
// different trace.
//
// So this is where the question actually gets settled. A browser has a real canvas, so
// the two models are rendered at the SAME camera and subtracted, and a human looks at
// what moved. The gate says "something differs"; this says whether it matters.
//
// The difference image is AMPLIFIED (x6, clamped). An unamplified difference of four or
// five levels is invisible on a dark building, which is exactly the size of difference a
// port is most likely to introduce and least likely to be forgiven for.
const DIFF_GAIN = 6;
const DIFF_W = 300, DIFF_H = 200;

function diffCanvases() {
  const host = $('diffimgs');
  if (host.childElementCount !== 3) {
    host.textContent = '';
    for (const cap of ['this', 'that', 'difference x' + DIFF_GAIN]) {
      const fig = document.createElement('figure');
      const c = document.createElement('canvas');
      c.width = DIFF_W; c.height = DIFF_H;
      const f = document.createElement('figcaption'); f.textContent = cap;
      fig.append(c, f); host.append(fig);
    }
  }
  return [...host.querySelectorAll('canvas')];
}

function renderDiff() {
  const num = $('diffnum');
  num.textContent = '';
  const other = modelOf($('cmp').value);
  const host = $('diffimgs');
  if (!other) { host.textContent = ''; return; }

  const [ca, cb, cd] = diffCanvases();
  // Both at the CURRENT camera, whatever the sliders say — comparing at a camera you
  // cannot see is how a difference gets explained away.
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
  if (!differing) {
    const ok = document.createElement('div');
    ok.textContent = 'identical at this camera';
    num.append(ok);
  }
}

function fillCompare() {
  const sel = $('cmp');
  const keep = sel.value;
  sel.textContent = '';
  const none = document.createElement('option');
  none.value = ''; none.textContent = '— compare with —';
  sel.append(none);
  for (const r of MODELS) {
    if (r.key === state.key) continue;
    const o = document.createElement('option');
    o.value = r.key; o.textContent = r.key;
    sel.append(o);
  }
  sel.value = keep;
}

// ── controls ────────────────────────────────────────────────────────────────
const bind = (id, key, cast = Number) => {
  const el = $(id);
  el.value = state[key];
  el.oninput = () => { state[key] = cast(el.value); draw(); };
};
bind('heading', 'heading'); bind('dist', 'dist'); bind('eye', 'eye');
bind('seed', 'seed'); bind('night', 'night');
// Changing the SCALE changes how far away the model wants to be, so these two reframe
// rather than redraw — otherwise pushing h to 4 walks the building out of the top.
for (const k of ['fh', 'h']) {
  const el = $(k); el.value = state[k];
  el.oninput = () => { state[k] = Number(el.value); preset(state.preset); };
}

$('cmp').onchange = () => renderDiff();
$('facing').onchange = () => { state.E = $('facing').value.split(',').map(Number); draw(); };
$('search').oninput = () => renderList($('search').value);

const toggle = (id, key) => { $(id).onclick = () => { state[key] = !state[key]; $(id).classList.toggle('on', state[key]); draw(); }; };
toggle('wire', 'wire');

// THE TWO PRESETS, and why the second one is not a nicety. ADORN_NEAR exists for a
// truck cab at eye height 0 and a cockpit almost never sees it — so authoring only
// from a cockpit is exactly how near-tier detail ships broken. The cab preset is the
// only way to look at it.
function preset(which) {
  const f = frameFor(which);
  state.dist = Math.round(f.dist * 2) / 2; state.eye = Math.round(f.eye * 10) / 10; state.tier = f.tier;
  state.preset = which;
  $('preset-cab').classList.toggle('on', which === 'cab');
  $('preset-cockpit').classList.toggle('on', which !== 'cab');
  $('eye').value = state.eye; $('dist').value = state.dist;
  draw();
}
$('preset-cockpit').onclick = () => preset('cockpit');
$('preset-cab').onclick = () => preset('cab');

let spinRaf = 0;
$('spin').onclick = () => {
  state.spin = !state.spin;
  $('spin').classList.toggle('on', state.spin);
  if (!state.spin) { cancelAnimationFrame(spinRaf); return; }
  const step = () => {
    if (!state.spin) return;
    state.heading = (state.heading + 0.6) % 360;
    $('heading').value = state.heading;
    // Only the main viewport per frame: the strip and the sidebar do four more
    // captures and every readout, which is not a thing to do sixty times a second.
    sizeCanvas($('view'));
    try { renderModelPreview($('view'), previewOpts()); } catch { /* reported on the next still frame */ }
    spinRaf = requestAnimationFrame(step);
  };
  spinRaf = requestAnimationFrame(step);
};

window.__msSelect = (i) => { selectedSeg = i; draw(); };
window.__msSelected = () => selectedSeg;
window.__msModel = (key) => MODELS.find((r) => r.key === key)?.m || null;
// MODELS is a snapshot of the registry taken at load, so a model created since then is
// editable and previewable but absent from the list — which reads as it having vanished.
// A new binding is registered here instead; the baked module catches up on the next reload.
window.__msRegister = (key) => {
  if (MODELS.some((r) => r.key === key)) return;
  MODELS.push({ key, m: editorRecordFor(key) });
  MODELS.sort((a, b) => a.key.localeCompare(b.key));
};
window.__msReselect = (key) => {
  window.__msRegister(key);
  state.key = key; invalidateEdit(key);
  renderList($('search').value); fillCompare(); preset(state.preset);
};
// A DELETED model has to leave the list for the same reason, and the selection has to go
// somewhere that still exists.
window.__msUnregister = (key) => {
  const i = MODELS.findIndex((r) => r.key === key);
  if (i >= 0) MODELS.splice(i, 1);
  invalidateEdit(key);
  if (state.key === key) state.key = MODELS[0]?.key || null;
  renderList($('search').value); fillCompare(); preset(state.preset);
};

addEventListener('resize', () => { if (!state.spin) draw(); });

renderList('');
fillCompare();
preset('cockpit');
// The editor loads its documents after the first paint, so the inspector is usable
// immediately and a server that is not answering degrades to read-only rather than blank.
initGizmo();
initEditor({ state, onChange: draw }).then(() => { invalidateEdit(state.key); draw(); })
  .catch((e) => { $('esave').className = 'err'; $('esave').textContent = 'no write path: ' + e.message; });

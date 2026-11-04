// TURNING A HAND-WRITTEN ARM INTO AN AUTHORED DOCUMENT.
//
// SHAPE_SINK capture already turns any arm into exact segment data — that is the premise of
// docs/reference/building-shapes.md. An authored model is the same data with the affine triples
// read back out as plain numbers, so this is the inversion and nothing more.
//
// It lives in client/shared/ because THREE processes run it: scripts/shapes/autoport.mjs (the
// survey and the batch port), and the Modelshop, which forks an arm into an editable copy in the
// BROWSER. One inversion, or the tool and the build disagree about what a port even is.
//
// WHAT CAPTURE GIVES BACK NOW, and what it still can't:
//
//   · ADORNMENTS AND TRIM aren't mass and capture never sees them. With `opts.armTrim` the port
//     doesn't try: the arm keeps drawing them over the ported mass (drawArmTrim in windshield.js),
//     and its hand-placed ARM_DETAIL list comes across as editable `detail`. Without it, a mast
//     is the one thing put back.
//   · PER-BOX SEED: recorded (`seed`, an offset from the tile's).
//   · FACING: the 79-of-79 facing failure that ended the first port was arms drawing most boxes at
//     yaw 0 at every facing while the port turned them all. `shapeTurns` says which, and a box the
//     arm leaves square to the map is written `mapAligned`.
//   · ENTRANCE-ONLY MASS: written `front`.
//   · DRUM SKINS: `skin` and its fields, for the house factories and for any closure that answers
//     from the light alone. A closure that paints a gradient is still the arm's.
//   · STILL NOT: per-face palettes (capture records one), a barrel's half-width (see the known bug
//     in compilePart), and a scalar that mixes footprint and height.
//
// The port differ is what decides a port is faithful, never this file.
import { DEFAULT_BASIS, DETAIL_SCHEMA, SEG_SCHEMA } from './building-model-schema.js';
// The affine solve leaves float dust in the components it meant to zero — 488 of 498 apparent
// "mixed" triples across the city are below 1e-9. Testing against exact zero calls two thirds of
// the city unportable for no reason, so the comparison is against a tolerance.
const EPS = 1e-6;

// Triple → { value, tag }, the inverse of toTriple(). A triple with more than one live component
// is NOT authorable, deliberately: see the schema's note on why a mixed basis is refused.
export function untriple(t, basis) {
  if (!t) return null;
  const live = [Math.abs(t[0]) > EPS, Math.abs(t[1]) > EPS, Math.abs(t[2]) > EPS];
  const n = live.filter(Boolean).length;
  if (n === 0) return { value: 0, tag: null };
  if (n > 1) return null;
  if (live[0]) return { value: t[0] * basis.fh, tag: 'fh' };
  if (live[1]) return { value: t[1] * basis.h, tag: 'h' };
  return { value: t[2], tag: 'abs' };
}

// Six decimals, not four: the trace differ compares screen positions to a hundredth of a pixel,
// and rounding an authored number to 4dp moved a wall by exactly that — reporting a perfect port
// as a 2% divergence, which is the differ measuring my rounding rather than the port.
// Nine, not six: at six, two equal slabs on a Halcyon tower came back 1e-6 apart, and the shape
// snapshot (building-shapes.js) broke the tie between them the other way.
const round = (n) => Number(n.toFixed(9));

// One captured segment → one authored segment, or a reason it cannot be one.
function portSeg(s, basis) {
  if (!SEG_SCHEMA[s.kind]) return { reason: `${s.kind} is not an authorable kind` };
  const def = SEG_SCHEMA[s.kind];
  const out = { kind: s.kind }, scale = {};
  for (const [f, defTag] of Object.entries(def.geom)) {
    // A barrel's and a sawtooth's z1 is DERIVED by the compile (z0 + the rise), and the
    // capture's own z1 for them is a MIXED triple because the two halves sit on different
    // bases. Reading it back as an authored field would reject every one of them for a
    // value nobody authored.
    if (f === 'z1' && (s.kind === 'barrel' || s.kind === 'sawtooth')) continue;
    // A box's half-extents are recorded pre-clamp as `hwRaw`/`fdRaw`; a barrel's `hw` is just `hw`.
    const capField = s.kind === 'box' && (f === 'hw' || f === 'fd') ? f + 'Raw' : f;
    const t = s[capField];
    if (!t) continue;
    const u = untriple(t, basis);
    if (!u) return { reason: `'${f}' depends on BOTH footprint and height (${JSON.stringify(t.map(round))}) — a mixed basis is not authorable` };
    out[f] = round(u.value);
    if (u.tag && u.tag !== defTag) scale[f] = u.tag;
  }
  if (Object.keys(scale).length) out.scale = scale;
  // `seed` comes through here too: capture records it as the offset the schema wants.
  for (const f of Object.keys(def.plain)) if (s[f] != null) out[f] = s[f];
  // Mass the arm drew only with its entrance turned to the camera. It was refused here until the
  // authored renderer could hold it back the same way (`front`).
  if (s.frontOnly) out.front = true;
  // A drum's skin, as the factory the arm called and its arguments (litStyle's `recipe`).
  if (s.recipe) for (const [f, v] of Object.entries(s.recipe)) if (v != null) out[f] = v;
  // …and its lid's, under the same names with `cap` in front (skin → capSkin, lo → capLo).
  if (s.capRecipe) for (const [f, v] of Object.entries(s.capRecipe)) if (v != null) out['cap' + f[0].toUpperCase() + f.slice(1)] = v;
  // ⚠ roof is emitted EXPLICITLY, always. The authored default is 'a box has a roof', which is
  // the friendly default for someone building a shed by hand — but an arm that passed nothing got
  // NO roof, and a port that omits the field would silently cap an open box. The two defaults
  // disagree on purpose; a port must not inherit the authoring one.
  if (s.kind === 'box') out.roof = !!s.roof;
  return { seg: out };
}

// The arm's hand-placed detail list (ARM_DETAIL), which is already in the detail schema with its
// numbers as triples, read back into authored numbers so a port can edit it like any other part.
function portDetail(list, basis) {
  const out = [];
  for (const d of list) {
    const def = DETAIL_SCHEMA[d.kind];
    if (!def) return { reason: `detail kind '${d.kind}' is not in DETAIL_SCHEMA` };
    const part = { kind: d.kind }, scale = {};
    for (const [f, v] of Object.entries(d)) {
      if (f === 'kind') continue;
      if (!(f in def.geom)) { part[f] = v; continue; }
      const u = untriple(v, basis);
      if (!u) return { reason: `detail ${d.kind}.${f} depends on BOTH footprint and height` };
      part[f] = round(u.value);
      if (u.tag && u.tag !== def.geom[f]) scale[f] = u.tag;
    }
    if (Object.keys(scale).length) part.scale = scale;
    out.push(part);
  }
  return { detail: out };
}

// `opts.armTrim` ports the MASS and leaves everything else to the arm (see drawArmTrim in
// windshield.js): the arm keeps drawing its masts, so they are not copied, and its ARM_DETAIL list
// comes across as the model's own `detail`, where it can be edited. `ws.ARM_DETAIL` is the table;
// without it the detail list stays the arm's.
export function portModel(ws, key, m, seed = 3, opts = {}) {
  const segs = ws.shapeForModel(m, seed);
  if (!segs || !segs.length) return { errors: ['no capture — the arm records no mass at all'] };
  const basis = { ...DEFAULT_BASIS };
  const out = [], errors = [];
  // Which boxes the arm leaves square to the map when the entrance turns. Optional, because the
  // Modelshop's renderer handle may not carry it; without it every box turns, as it always has.
  const turns = ws.shapeTurns ? ws.shapeTurns(m, seed) : null;
  for (const [i, s] of segs.entries()) {
    const r = portSeg(s, basis);
    if (r.reason) errors.push(`segs[${i}]: ${r.reason}`);
    else {
      if (turns && turns[i] && turns[i].turns === false) r.seg.mapAligned = true;
      out.push(r.seg);
    }
  }
  if (errors.length) return { errors };

  const id = key.replace(/^(named|type):/, '');
  const doc = {
    id,
    note: 'Ported from the hand-written ' + m.type + ' arm by scripts/shapes/autoport.mjs. '
      + 'Adornments are NOT captured — see that script and the measured pixdiff below.',
    basis,
    segs: out,
    adorn: [],
    bind: [key.startsWith('named:') ? { by: 'name', key: id } : { by: 'type', key: id }],
    portedFrom: m.type,
  };
  if (m.pal) doc.pal = m.pal;
  if (m.neon) doc.neon = m.neon;
  if (opts.armTrim) {
    doc.armTrim = true;
    // The arm record's own flags that something other than the arm reads (the kit, the signage).
    if (m.noKit) doc.noKit = true;
    if (m.trade && m.trade !== m.type) doc.trade = m.trade;
    if (m.signWorks) doc.signWorks = true;
    doc.note = 'Ported from the hand-written ' + m.type + ' arm by scripts/shapes/autoport.mjs. The mass and '
      + 'the detail list are this file; everything else (lights, signs, moving parts) is still drawn by the arm.';
    const list = ws.ARM_DETAIL && ws.ARM_DETAIL[m.type];
    if (list && list.length && !(m.detail && m.detail.length)) {
      const r = portDetail(list, basis);
      if (r.reason) return { errors: [r.reason] };
      doc.detail = r.detail;
    }
    return { doc };
  }
  if (segs.spars && segs.spars.length) {
    // A mast IS authorable, and capture keeps it — on `.spars`, outside the mass list.
    for (const sp of segs.spars) {
      const z0 = untriple(sp.wz0 ?? sp.z0, basis), z1 = untriple(sp.wz1 ?? sp.z1, basis);
      const cx = untriple(sp.cx ?? sp.dx, basis), cy = untriple(sp.cy ?? sp.dy, basis);
      if (!z0 || !z1 || !cx || !cy) continue;
      const a = { kind: 'mast', cx: round(cx.value), cy: round(cy.value), z0: round(z0.value), z1: round(z1.value) };
      const sc = {};
      for (const [f, u, d] of [['cx', cx, 'fh'], ['cy', cy, 'fh'], ['z0', z0, 'h'], ['z1', z1, 'h']]) {
        if (u.tag && u.tag !== d) sc[f] = u.tag;
      }
      if (Object.keys(sc).length) a.scale = sc;
      doc.adorn.push(a);
    }
  }
  return { doc };
}

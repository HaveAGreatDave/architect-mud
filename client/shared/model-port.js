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
// ⚠ WHAT CAPTURE CANNOT GIVE BACK, and therefore what a fork loses:
//
//   · ADORNMENTS. Every adornment no-ops under SHAPE_SINK by design, so a captured arm has no
//     neon, no marquee, no dish, no beacon. A masts is the one exception — capture keeps it on
//     `.spars` — and it is the only one this can put back.
//   · PER-BOX SEED. draw3DBoxAt takes a seed that picks wall-texture jitter and the sink does
//     not record it, so a forked building is textured differently even where it is identical.
//   · ONE ENTRANCE FACING. Capture freezes the facing it ran at. This is the finding that ended
//     the port of the city (see the Modelshop README): 79 arms that were byte-identical at the
//     capture conditions all broke when the facing changed.
//
// So a fork is a STARTING POINT you then edit, never a faithful copy of the arm. The Modelshop
// says so at the moment you make one, and the fork deliberately does not claim `portedFrom`,
// which is what would make it override the arm it came from.
import { DEFAULT_BASIS, SEG_SCHEMA } from './building-model-schema.js';
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
const round = (n) => Number(n.toFixed(6));

// One captured segment → one authored segment, or a reason it cannot be one.
function portSeg(s, basis) {
  if (!SEG_SCHEMA[s.kind]) return { reason: `${s.kind} is not an authorable kind` };
  if (s.frontOnly) return { reason: 'entrance-face-only mass has no authored equivalent' };
  const def = SEG_SCHEMA[s.kind];
  const out = { kind: s.kind }, scale = {};
  for (const [f, defTag] of Object.entries(def.geom)) {
    // A barrel's and a sawtooth's z1 is DERIVED by the compile (z0 + the rise), and the
    // capture's own z1 for them is a MIXED triple because the two halves sit on different
    // bases. Reading it back as an authored field would reject every one of them for a
    // value nobody authored.
    if (f === 'z1' && (s.kind === 'barrel' || s.kind === 'sawtooth')) continue;
    const capField = f === 'hw' ? 'hwRaw' : f === 'fd' ? 'fdRaw' : f;
    const t = s[capField];
    if (!t) continue;
    const u = untriple(t, basis);
    if (!u) return { reason: `'${f}' depends on BOTH footprint and height (${JSON.stringify(t.map(round))}) — a mixed basis is not authorable` };
    out[f] = round(u.value);
    if (u.tag && u.tag !== defTag) scale[f] = u.tag;
  }
  if (Object.keys(scale).length) out.scale = scale;
  for (const f of Object.keys(def.plain)) if (s[f] != null) out[f] = s[f];
  // ⚠ roof is emitted EXPLICITLY, always. The authored default is 'a box has a roof', which is
  // the friendly default for someone building a shed by hand — but an arm that passed nothing got
  // NO roof, and a port that omits the field would silently cap an open box. The two defaults
  // disagree on purpose; a port must not inherit the authoring one.
  if (s.kind === 'box') out.roof = !!s.roof;
  return { seg: out };
}

export function portModel(ws, key, m, seed = 3) {
  const segs = ws.shapeForModel(m, seed);
  if (!segs || !segs.length) return { errors: ['no capture — the arm records no mass at all'] };
  const basis = { ...DEFAULT_BASIS };
  const out = [], errors = [];
  for (const [i, s] of segs.entries()) {
    const r = portSeg(s, basis);
    if (r.reason) errors.push(`segs[${i}]: ${r.reason}`);
    else out.push(r.seg);
  }
  if (errors.length) return { errors };

  const id = key.replace(/^(named|type):/, '');
  const doc = {
    id,
    note: 'Ported from the hand-written ' + m.type + ' arm by scripts/shapes/autoport.mjs. '
      + 'Adornments and per-box texture seeds are NOT captured — see that script and the measured pixdiff below.',
    basis,
    segs: out,
    adorn: [],
    bind: [key.startsWith('named:') ? { by: 'name', key: id } : { by: 'type', key: id }],
    portedFrom: m.type,
  };
  if (m.pal) doc.pal = m.pal;
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

// autoport — turn a hand-written model arm into an authored model file, by capture.
//
//   node scripts/shapes/autoport.mjs --survey            # what is portable, and how faithfully
//   node scripts/shapes/autoport.mjs type:warehouse      # print the authored doc for one arm
//   node scripts/shapes/autoport.mjs type:warehouse -w   # …and write it to content/building_models/
//
// THE IDEA. SHAPE_SINK capture already turns any arm into exact segment data — that is the whole
// premise of docs/reference/building-shapes.md. An authored model is the same data with the affine
// triples read back out as plain numbers. So a port does not need a human to re-measure a building;
// it needs the triples inverted and the result CHECKED, which is what modeldiff.mjs is for.
//
// ⚠ WHAT CAPTURE CANNOT GIVE BACK, and therefore what a port loses:
//
//   · ADORNMENTS. Every adornment no-ops under SHAPE_SINK by design, so a captured arm has no
//     neon, no marquee, no dish, no beacon, no mast art. An auto-port of an arm that has any is a
//     visible downgrade, and --survey measures exactly how big a one.
//   · PER-BOX SEED. draw3DBoxAt takes a seed that picks wall-texture jitter; the sink does not
//     record it. The authored renderer uses `seed + index`, so a ported building's walls are
//     textured differently even when its geometry is identical.
//   · BARREL and SAWTOOTH roofs, `frontOnly` mass, and MIXED triples (a scalar that depends on
//     both footprint and storey height — the nine models that derive a vertical from a span).
//     None of these is authorable, so those arms are not portable and the survey says so.
//
// A port is therefore never assumed to be faithful. It is generated here and MEASURED there.
import { loadWindshield } from './dom-stub.mjs';
import { compareModels, MATRIX } from './modeldiff.mjs';
import { DEFAULT_BASIS, SEG_SCHEMA } from '../../client/shared/building-model-schema.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT_DIR = join(ROOT, 'content', 'building_models');

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
  if (s.kind !== 'box' && s.kind !== 'drum') return { reason: `${s.kind} roofs are not authorable yet` };
  if (s.frontOnly) return { reason: 'entrance-face-only mass has no authored equivalent' };
  const def = SEG_SCHEMA[s.kind];
  const out = { kind: s.kind }, scale = {};
  for (const [f, defTag] of Object.entries(def.geom)) {
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

// ── The survey ──────────────────────────────────────────────────────────────
// The only honest way to decide what to port. For every arm: can it be expressed at all, and if it
// can, HOW FAR from the original does the result actually draw? The second question is the one that
// matters and the one nobody can answer by looking.
async function survey(ws, { write = false, limit = 1 } = {}) {
  const rows = [];
  for (const { key, m } of ws.shapeModelRegistry()) {
    if (m.type === 'authored') continue;
    const { doc, errors } = portModel(ws, key, m);
    if (errors) { rows.push({ key, ok: false, why: errors[0] }); continue; }
    // Compile it the way the bake would, then diff the result against the arm it came from.
    const { compileModel } = await import('../../client/shared/building-model-schema.js');
    const { rec } = compileModel(doc, key);
    const r = compareModels(ws, m, rec, { name: key });
    rows.push({ key, ok: true, worst: r.worst, doc });
  }
  rows.sort((a, b) => (a.ok === b.ok ? (a.worst ?? 1) - (b.worst ?? 1) : a.ok ? -1 : 1));

  const portable = rows.filter((r) => r.ok);
  const faithful = portable.filter((r) => r.worst <= limit / 100);
  console.log(`autoport survey — ${rows.length} hand-written arms`);
  console.log(`  ${portable.length} can be EXPRESSED as authored boxes and drums`);
  console.log(`  ${rows.length - portable.length} cannot, and stay as code:`);
  const why = {};
  for (const r of rows.filter((x) => !x.ok)) {
    const k = r.why.replace(/segs\[\d+\]: /, '').replace(/\(.*\)/, '').trim();
    why[k] = (why[k] || 0) + 1;
  }
  for (const [k, n] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(3)}  ${k}`);

  // ── WHICH AXIS BREAKS IT ────────────────────────────────────────────────
  // The headline number ("all of them diverge") is true and useless. What decides whether a port
  // is possible is WHICH of the five things a model varies with the port stops tracking, so the
  // survey isolates them one at a time against the capture conditions.
  const { diffTrace } = await import('./modeldiff.mjs');
  const { compileModel } = await import('../../client/shared/building-model-schema.js');
  const base = { night: 0, heading: 35, dist: 8, eyeH: 2, fh: 0.4, h: 1, seed: 3, tier: 0, E: [0, 1] };
  const axis = { exact: 0, scale: 0, seed: 0, facing: 0, adorn: 0, capture: 0 };
  for (const r of portable) {
    const m = ws.shapeModelRegistry().find((x) => x.key === r.key).m;
    const rec = compileModel(r.doc, r.key).rec;
    const d = (o) => diffTrace(
      ws.captureModelTrace(m, { ...base, ...o, name: r.key }),
      ws.captureModelTrace(rec, { ...base, ...o, name: r.key }),
    ).differing;
    if (d({})) { axis.capture++; continue; }
    axis.exact++;
    if (d({ fh: 0.8 }) || d({ h: 2 })) axis.scale++;
    if (d({ seed: 1 }) || d({ seed: 4 })) axis.seed++;
    if (d({ E: [0, -1] }) || d({ E: [1, 0] })) axis.facing++;
    if (d({ tier: 2 })) axis.adorn++;
  }
  console.log(`\n  of the ${portable.length} expressible, at the CAPTURE conditions the port is:`);
  console.log(`      ${String(axis.exact).padStart(3)}  byte-identical to the arm`);
  console.log(`      ${String(axis.capture).padStart(3)}  already different (drum shading and per-box texture seeds are not captured)`);
  console.log(`\n  and of those ${axis.exact} exact ones, how many stop matching when you change:`);
  console.log(`      ${String(axis.scale).padStart(3)}  the footprint or storey height   <- the affine basis holds`);
  console.log(`      ${String(axis.seed).padStart(3)}  the tile seed                    <- capture freezes ONE seed`);
  console.log(`      ${String(axis.facing).padStart(3)}  the entrance facing              <- capture freezes ONE facing`);
  console.log(`      ${String(axis.adorn).padStart(3)}  adornments back on                <- capture drops every one`);
  // ── THE CONTROL ─────────────────────────────────────────────────────────
  // "79 of 79 break on facing" has two possible causes that look identical from here: the arm
  // draws something genuinely different per facing, or the port rotates it wrongly. Tracing
  // drawModelLOD settles it — that renderer already rotates CAPTURED geometry to the entrance
  // exactly the way an authored model does, so if the ARM diverges from it too, the facing
  // dependence belongs to the arm and no rotation-based port can be faithful.
  //
  // This is the evidence the whole "we are not porting" conclusion rests on, so it is printed
  // rather than left in somebody's terminal history.
  let armVsLod = 0, cases = 0;
  for (const r of portable) {
    const m = ws.shapeModelRegistry().find((x) => x.key === r.key).m;
    for (const E of [[0, -1], [1, 0]]) {
      cases++;
      const arm = ws.captureModelTrace(m, { ...base, E, name: r.key });
      const lod = ws.captureModelTrace(m, { ...base, E, name: r.key, lod: 1 });
      if (diffTrace(arm, lod).differing) armVsLod++;
    }
  }
  console.log(`\n  control — is an arm a pure rotation of its own capture?`);
  console.log(`      ${armVsLod}/${cases}  arms differ from the shipping drawModelLOD at a non-canonical facing`);
  console.log(`      ${armVsLod === cases ? 'No. So no rotation-based port can be faithful, and this is not a bug in the porter.'
    : 'Some are — the facing failures above are worth re-examining.'}`);

  console.log(`\n  ${faithful.length} arm(s) are within the ${limit}% bar across all ${MATRIX.length} cameras and would be ported.`);

  if (write) {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const r of faithful) {
      r.doc.pixdiff = Math.max(0, Number(r.worst.toFixed(4)));
      writeFileSync(join(OUT_DIR, r.doc.id + '.json'), JSON.stringify(r.doc, null, 2) + '\n', 'utf8');
    }
    console.log(`\n  wrote ${faithful.length} model(s) to content/building_models/ — now run: npm run models:bake`);
  }
  return rows;
}

async function main() {
  const ws = await loadWindshield();
  const argv = process.argv.slice(2);
  const write = argv.includes('-w') || argv.includes('--write');
  const limIdx = argv.indexOf('--limit');
  const limit = limIdx >= 0 ? Number(argv[limIdx + 1]) : 1;

  if (argv.includes('--survey')) { await survey(ws, { write, limit }); return; }

  const key = argv.find((a) => a.startsWith('type:') || a.startsWith('named:'));
  if (!key) {
    console.error('usage: autoport.mjs --survey [--limit <percent>] [-w] | <key> [-w]');
    process.exit(2);
  }
  const m = ws.shapeModelRegistry().find((r) => r.key === key)?.m;
  if (!m) { console.error('no such model: ' + key); process.exit(2); }
  const { doc, errors } = portModel(ws, key, m);
  if (errors) { for (const e of errors) console.error('  ✗ ' + e); process.exit(1); }
  const { compileModel } = await import('../../client/shared/building-model-schema.js');
  const r = compareModels(ws, m, compileModel(doc, key).rec, { name: key });
  doc.pixdiff = Math.max(0, Number(r.worst.toFixed(4)));
  console.error(`  measured divergence from the arm: ${(r.worst * 100).toFixed(2)}% of drawing operations`);
  if (write) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, doc.id + '.json'), JSON.stringify(doc, null, 2) + '\n', 'utf8');
    console.error('  wrote content/building_models/' + doc.id + '.json — now run: npm run models:bake');
  } else {
    console.log(JSON.stringify(doc, null, 2));
  }
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

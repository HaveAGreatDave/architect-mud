// HOW BIG IS A NAME BAND, AND WHAT KIND OF SIGN IS IT?
//
// `marqueeSpan` sized a band off `clamp(half * 0.26, …)` — its own WIDTH — which is the coupling
// `marqueeStand` was written to break, in the other axis. A band was therefore a fixed world
// height whatever it was bolted to, so a two-storey shop and a ten-storey block wore the same
// fascia and on the short one it was most of the elevation. Measured before the fix, at two
// floors: the median band was 42% of the whole building and the worst 57%.
//
// What a fascia is, is a fraction of a STOREY. So that is what this measures, and the gate is a
// ceiling in storeys rather than a ratio to the building — a band on a tower and a band on a
// corner shop are the same fitting and should measure the same.
//
// It also reports the KIND spread, because `fasciaKind` rolls off each building's own seed and
// "did the other three treatments actually reach the city" is a question with a number rather
// than a screenshot. A roll that lands every building on `tube` is indistinguishable from the
// feature being off, and the flag's own 0 is exactly that — which is the control below.
//
//   node scripts/shapes/signsize.mjs            # gate
//   node scripts/shapes/signsize.mjs --report   # the deepest bands, and the kind spread
//   node scripts/shapes/signsize.mjs --before   # the same sweep with RENDER_TUNE.signFascia = 0
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');
const BEFORE = process.argv.includes('--before');
if (BEFORE) { ws.RENDER_TUNE.signFascia = 0; ws.RENDER_TUNE.signKind = 0; }

// ⚠ A REAL CAMERA, for `signstand`'s reason: the band reaches the decal layer through `cam.unproj`
// and a stub camera has none, so the stub measures a path the game does not run.
const cam = ws.makeCam(640, 160, 360, { heading: 0, height: 0, eyeH: 0.24, map: null });

// ⚠ SWEPT OVER FLOOR COUNTS, because the defect was invisible at any single one. The band was the
// same world height on all of them; it is the SHORT buildings where that reads as a sign eating
// the frontage, and the short ones are most of a shopping street.
const FLOORS = [2, 3, 4, 6, 10];

// What a fascia may be, in storeys of the building it is on. A shopfront fascia is about half the
// floor it sits under; a cinema marquee is the deep end of the range. Past this it is not a sign
// on a building, it is a building with a sign for a facade.
const MAX_STOREYS = 0.62;

// ⚠ AND A CENSUS THAT COUNTS NAMES IS NOT A GATE. The block above can see that four kinds reach
// the registry; it cannot see whether they PAINT differently, so a treatment that quietly fell
// through to the tube's own strokes would be reported as present and be invisible on the street.
// So each one is forced and a signed model is traced through the ordinary path — the same recording
// context `models:diff` compares — and the four traces have to differ from each other.
// ⚠ BY HASH, NEVER BY OP COUNT: `applied` and `painted` both draw 192 ops and are not the same sign.
function kindTraces(ws) {
  const reg = Object.fromEntries(ws.shapeModelRegistry().map((e) => [e.key, e.m]));
  const m = reg['type:off_licence'] || ws.shapeModelRegistry()[0].m;
  const hash = (t) => { let h = 0; for (const op of t) { const s = JSON.stringify(op); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; } return h; };
  const out = new Map();
  for (const k of ['tube', 'box', 'applied', 'painted']) {
    ws.signKindForce(k);
    try { out.set(k, hash(ws.captureModelTrace(m, { night: 1, name: 'SPIRIT LEVEL', dist: 4 }))); }
    finally { ws.signKindForce(null); }
  }
  return out;
}

const rows = [];
let models = 0, threw = 0;
const kinds = new Map();

for (const { key, m } of ws.shapeModelRegistry()) {
  models++;
  // ⚠ OVER SEEDS, NOT AT ONE. See the note on the export: the roll is per TILE.
  for (let t = 0; t < 24; t++) { const k = ws.fasciaKindOf(m, t * 977 + 13); kinds.set(k, (kinds.get(k) || 0) + 1); }
  for (const floors of FLOORS) {
    const { fh, h } = ws.buildingScaleFor(floors, 3);
    const census = [];
    ws.signStandCensus(census);
    let r;
    try { r = ws.canvasResidue(m, { cam, night: 1, bn: 'THE EXAMPLE', dy: -2, fh, h }); }
    finally { ws.signStandCensus(null); }
    if (r && r.threw) { threw++; continue; }
    for (const b of census) {
      const bh = b.zHi - b.zLo;
      rows.push({ key, floors, storeys: bh / (h / floors), ofBldg: bh / h });
    }
  }
}

const q = (a, x) => a[Math.min(a.length - 1, Math.floor(a.length * x))];
if (REPORT) {
  console.log('\n  floors  bands   med-storeys   worst-storeys   med-%bldg   worst-%bldg');
  for (const f of FLOORS) {
    const at = rows.filter((r) => r.floors === f);
    if (!at.length) continue;
    const s = at.map((r) => r.storeys).sort((a, b) => a - b);
    const p = at.map((r) => r.ofBldg).sort((a, b) => a - b);
    console.log('  ' + String(f).padStart(5) + String(s.length).padStart(7)
      + q(s, 0.5).toFixed(2).padStart(13) + s[s.length - 1].toFixed(2).padStart(15)
      + (q(p, 0.5) * 100).toFixed(1).padStart(12) + '%' + (p[p.length - 1] * 100).toFixed(1).padStart(12) + '%');
  }
  const deep = [...new Map(rows.filter((r) => r.floors === 2).map((r) => [r.key, r])).values()]
    .sort((a, b) => b.storeys - a.storeys).slice(0, 10);
  console.log('\n  deepest bands (at 2 floors)');
  for (const r of deep) console.log('    ' + r.key.padEnd(34) + r.storeys.toFixed(2) + ' storeys   ' + (r.ofBldg * 100).toFixed(1) + '% of the building');
  console.log('\n  fascia kinds over ' + models + ' models x 24 tile seeds');
  for (const [k, n] of [...kinds.entries()].sort((a, b) => b[1] - a[1])) {
    console.log('    ' + k.padEnd(10) + String(n).padStart(4) + '  ' + (n * 100 / (models * 24)).toFixed(0) + '%');
  }
  console.log('');
}

if (threw) { console.error(`  ${threw} model pass(es) threw during the census`); process.exit(1); }
if (!rows.length) { console.error('  signsize: no marquee bands were placed at all — the census is not wired'); process.exit(1); }

const over = [...new Map(rows.filter((r) => r.storeys > MAX_STOREYS + 1e-6).map((r) => [r.key + r.floors, r])).values()]
  .sort((a, b) => b.storeys - a.storeys);
if (over.length) {
  console.error(`\n  ${over.length} band(s) deeper than ${MAX_STOREYS} of their own storey:\n`);
  for (const r of over.slice(0, 20)) console.error(`    ${r.key} at ${r.floors} floors — ${r.storeys.toFixed(2)} storeys (${(r.ofBldg * 100).toFixed(1)}% of the building)`);
  console.error('\n  `marqueeSpan` caps a band at `RENDER_TUNE.signFascia` of a storey, so a band over that');
  console.error('  means the cap is off or something downstream of it has grown the quad again.\n');
  process.exit(1);
}
// ⚠ THE KIND SPREAD IS GATED TOO, and it is the half that can silently evaporate: a roll that
// lands everything on one kind draws a perfectly good city that looks exactly like the feature
// having been reverted. `--before` is that city, and is what this number is worth reading against.
if (!BEFORE) {
  const tr = kindTraces(ws);
  const seen = new Map();
  for (const [k, h] of tr) {
    if (seen.has(h)) {
      console.error(`\n  fascia kinds '${seen.get(h)}' and '${k}' paint the same sign — one of them is not a treatment\n`);
      process.exit(1);
    }
    seen.set(h, k);
  }
  if (REPORT) console.log('  four kinds, four traces: ' + [...tr].map(([k, h]) => k + ' ' + h).join(' · ') + '\n');
}
if (!BEFORE && kinds.size < 4) {
  console.error(`\n  only ${kinds.size} fascia kind(s) reach the registry — 'fasciaKind' is rolling everything onto one treatment\n`);
  process.exit(1);
}
const worst = rows.map((r) => r.storeys).sort((a, b) => a - b);
console.log(`  signsize: ${rows.length} band(s) over ${models} models, deepest ${worst[worst.length - 1].toFixed(2)} storeys`
  + (BEFORE ? '' : ` · ${kinds.size} fascia kinds in the city`));

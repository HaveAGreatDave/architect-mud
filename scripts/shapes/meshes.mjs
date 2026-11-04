// meshes — the gate for authored vehicle meshes (content/vehicle_models/mesh_*.json).
//
//   node scripts/shapes/meshes.mjs          (in the pretest:regress chain and in shapes:smoke)
//
// A mesh file replaced a builder that was drawing the aircraft in code. The claims, each of which
// fails silently if it is wrong:
//   1. Every file validates and compiles at both details, to finite vertices. A string where a
//      number belongs is legal JSON and reaches the arithmetic as NaN, which paints nothing.
//   2. A file that says `portedFrom` is the SAME MESH its builder drew — same faces, same order,
//      every number Object.is-equal — at both details. This is what makes the conversion safe to
//      ship before anybody has looked at every face of it.
//   3. The renderer draws the file. A class whose mesh exists must never fall through to the
//      fixed-wing generator, which renders anything unknown as a Twin Otter and says nothing.
//   4. The rotor spec in a converted file draws exactly what the hardcoded rotor code drew.
//   5. The comparison in (2) can fail: nudge one number in a copy of a converted file and it must.
//      A gate that cannot go red is not a gate.
import { readFileSync, readdirSync } from 'node:fs';

const A3D = '../../client/game/js/panels/aircraft3d.js';
const VM = '../../client/shared/vehicle-mesh.js';
const m = await import(A3D);
const { compileMesh, meshDiff, validateMesh, meshStats, canon } = await import(VM);

const DIR = new URL('../../content/vehicle_models/', import.meta.url);
const files = readdirSync(DIR).filter((f) => /^mesh_.+\.json$/.test(f)).sort();
const problems = [], notes = [];
const docs = files.map((f) => ({ file: f, doc: JSON.parse(readFileSync(new URL(f, DIR), 'utf8')) }));

// 1 + 2
let ported = 0, faceTotal = 0;
for (const { file, doc } of docs) {
  const v = validateMesh(doc.params, file);
  for (const e of v.errors) problems.push(e);
  if (v.errors.length) continue;
  for (const detail of [0, 1]) {
    const { faces } = compileMesh(doc.params, { detail });
    const st = meshStats(faces);
    if (detail === 1) faceTotal += faces.length;
    if (st.ngons) notes.push(file + ': ' + st.ngons + ' faces of 5+ points at detail ' + detail + ' (the hull texture only maps 3- and 4-point faces)');
    // A truck file is held state by state in section 6, not as one face list.
    if (doc.params.portedFrom && !doc.params.truck) {
      const legacy = m.legacyMeshFaces(doc.id, detail);
      if (!legacy) { problems.push(file + ': portedFrom ' + doc.params.portedFrom + ' but there is no builder to hold it against'); continue; }
      // The builder drew geometry and never declared a finish or a paint slot, so the file is held
      // against it without either.
      const d = meshDiff(doc.params.finish == null ? faces : compileMesh(doc.params, { detail, finish: false }).faces, legacy,
        { ignore: doc.params.paints ? ['paint'] : [] });
      if (d) problems.push(file + ' detail ' + detail + ': differs from ' + doc.params.portedFrom + ' at face ' + d.index + ' (' + d.field + '). Run: npm run mesh -- diff ' + doc.id);
    }
  }
  if (doc.params.portedFrom) ported++;
}

// 3 — the class draws the file. Bind by what the renderer is asked for: a mesh's own id is its
// class, except one named as another file's armedMesh.
const armedOf = new Map(docs.filter((d) => d.doc.params.armedMesh).map((d) => [d.doc.params.armedMesh, d.doc.id]));
// A file another lists under `variants` is that class drawn for that variant (the racer's types).
const variantOf = new Map();
for (const { doc } of docs) for (const [v, id] of Object.entries(doc.params.variants || {})) variantOf.set(id, [doc.id, v]);
for (const [id, [cls, v]] of variantOf) {
  const doc = docs.find((d) => d.doc.id === id)?.doc;
  if (!doc) { problems.push('mesh_' + cls + '.json: variant ' + v + ' names mesh ' + id + ', which has no file'); continue; }
  if (m.variantMeshFor(cls, v) !== id) { problems.push('mesh_' + id + '.json: aircraftFaces(' + cls + ', variant ' + v + ') does not draw it'); continue; }
  if (meshDiff(m.aircraftFaces(cls, 1, false, v), compileMesh(doc.params, { detail: 1 }).faces)) problems.push('mesh_' + id + '.json: aircraftFaces(' + cls + ', ' + v + ') returns something other than the file');
}
for (const { doc } of docs) {
  if (variantOf.has(doc.id) || doc.params.truck) continue;
  const cls = armedOf.get(doc.id) || doc.id, armed = armedOf.has(doc.id);
  if (m.meshIdFor(cls, armed) !== doc.id) { problems.push('mesh_' + doc.id + '.json: aircraftFaces(' + cls + (armed ? ', armed' : '') + ') does not draw it'); continue; }
  const live = m.aircraftFaces(cls, 1, armed, '');
  if (meshDiff(live, compileMesh(doc.params, { detail: 1 }).faces)) problems.push('mesh_' + doc.id + '.json: aircraftFaces(' + cls + ') returns something other than the file');
}
// Every mesh class must be one the renderer lists, or the Modelshop and the render smoke never see it.
const ws = readFileSync(new URL('../../client/game/js/panels/windshield.js', import.meta.url), 'utf8');
const vc = ws.match(/export const VEHICLE_CLASSES = \[([^\]]*)\]/);
const classes = vc ? [...vc[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
for (const { doc } of docs) {
  if (armedOf.has(doc.id) || variantOf.has(doc.id) || doc.params.truck) continue;
  if (!classes.includes(doc.id)) problems.push('mesh_' + doc.id + '.json: class ' + doc.id + ' is not in VEHICLE_CLASSES (windshield.js), so no smoke and no Modelshop subject reaches it');
}

// 4 — a converted file's rotors draw what the hardcoded code drew. Recorded as a trace of every
// drawing call through a stub context, at a spread of spin states.
if (m.rotorTraceLegacy && m.rotorTrace) {
  for (const { doc } of docs) {
    if (!doc.params.portedFrom || !doc.params.rotors) continue;
    const cls = armedOf.get(doc.id) || doc.id, armed = armedOf.has(doc.id);
    for (const st of [{ spin: 0.3 }, { spin: 2.1, spool: 1, disc: 0.8 }, { spin: 5.0, parked: true }, { spin: 1.0, spool: 0.3, disc: 0.1 }]) {
      const a = m.rotorTrace(cls, { ...st, armed }), b = m.rotorTraceLegacy(cls, { ...st, armed });
      if (a !== b) { problems.push('mesh_' + doc.id + '.json: its rotors draw differently from the hardcoded rotor code (state ' + JSON.stringify(st) + ')'); break; }
    }
  }
}

// 5 — the comparison can go red. Take the first converted file, nudge one number deep in it, and
// demand a difference.
const first = docs.find((d) => d.doc.params.portedFrom && !d.doc.params.truck);
if (first) {
  const bent = JSON.parse(JSON.stringify(first.doc.params));
  const walk = (o) => { for (const k of Object.keys(o)) { if (typeof o[k] === 'number' && k !== 'sides' && k !== 'n') { o[k] += 1e-9; return true; } if (o[k] && typeof o[k] === 'object' && walk(o[k])) return true; } return false; };
  walk(bent.parts[0]);
  if (!meshDiff(compileMesh(bent, { detail: 1 }).faces, m.legacyMeshFaces(first.doc.id, 1))) problems.push('self-test: a nudged copy of mesh_' + first.doc.id + '.json still compares identical, so the identity check is not checking');
}

// 6 — a truck file (mesh_truck_<type>.json, written by truck-meshes.mjs) is the truck buildTruck drew,
// in every state a variant string asks for: bobtail and hitched, running and parked, a dropped box,
// each fitting alone and all of them at once (which puts the interleaved ones in their real order),
// at both details. The faces AND the meta the lamps, door art and articulation read. Then the renderer
// is shown to read the file: nudge one number through the Modelshop override and the truck must move.
const { FITTINGS } = await import('../../plugins/trucking/fittings.js');
const CODES = Object.values(FITTINGS).map((f) => f.code), EVERY = '^' + CODES.join('.');
const STATES = ['', '+t', '~p', '+t~p', '~s', '~s~p', EVERY, '+t' + EVERY, '+t~p' + EVERY, '~p' + EVERY, '~s' + EVERY,
  ...CODES.map((c) => '^' + c), ...CODES.map((c) => '+t^' + c)];
let trucks = 0;
const { truckFittingParts, vintageAnchors } = await import('./truck-fittings.mjs');
const { TRUCK_ROWS } = await import('../../client/shared/vehicle-models.js');
for (const { file, doc } of docs) {
  if (!doc.params.truck || !doc.params.portedFrom) continue;
  const type = doc.id.replace(/^truck_/, '');
  let ok = true;
  for (const detail of [1, 0]) for (const s of STATES) {
    const a = m.truckFileBuild(doc.params, type + s, detail), b = m.truckLegacyBuild(type + s, detail);
    const d = meshDiff(a.faces, b.faces);
    if (d) { problems.push(file + ' ' + JSON.stringify(type + s) + ' detail ' + detail + ': differs from buildTruck at face ' + d.index + ' (' + d.field + ')'); ok = false; break; }
    if (canon(a.meta) !== canon(b.meta)) { problems.push(file + ' ' + JSON.stringify(type + s) + ' detail ' + detail + ': its TRUCK_META differs from buildTruck\'s'); ok = false; break; }
  }
  if (!ok) continue;
  trucks++;
  // The fittings generator (truck-fittings.mjs) off this truck's own anchors draws the file's fittings.
  if (TRUCK_ROWS[type]) {
    const want = doc.params.parts.find((p) => p.name === 'fittings')?.parts || [];
    const got = truckFittingParts(vintageAnchors(TRUCK_ROWS[type], doc.params.truck.pods.filter((q) => !q[3]).map(([f, g]) => [f, g])));
    const at = want.findIndex((p, i) => canon(p) !== canon(got[i]));
    if (at >= 0 || want.length !== got.length) problems.push(file + ': truck-fittings.mjs no longer draws its fittings (first difference at part ' + (at >= 0 ? at : Math.min(want.length, got.length)) + ')');
  }
  const bent = JSON.parse(JSON.stringify(doc.params));
  bent.parts[0].parts[0].f[0] += 1e-9;
  m.setMeshOverride(doc.id, bent);
  const moved = meshDiff(m.aircraftFaces('truck', 1, false, type), m.truckLegacyBuild(type, 1).faces);
  m.setMeshOverride(doc.id, null);
  if (!moved) problems.push(file + ': a nudged copy draws the same truck, so the renderer is not reading the file (or the check is not checking)');
}
if (trucks) ported += trucks;

// 7 — a truck edition (a file a stock truck names in `variants`, written by a concepts/ generator)
// keeps the stock truck's frame, so it hitches any trailer in the yard and swings it the same way:
// the same kingpin, cab back and box nose in every state. It builds in every state, nothing of the
// tractor stands above the trailer's floor aft of where the stock stack stood (the swing clearance),
// and asking for `~e<name>` draws it.
const TRAILER_FLOOR = 0.075, STACK_REACH = 0.013;
for (const { file, doc } of docs) {
  if (!doc.params.truck) continue;
  for (const [ed, id] of Object.entries(doc.params.variants || {})) {
    const ef = docs.find((d) => d.doc.id === id);
    if (!ef) continue;   // section 3 reports the missing file
    const type = doc.id.replace(/^truck_/, ''), E = ef.doc.params;
    if (!E.truck) { problems.push(ef.file + ': a truck edition needs a truck block'); continue; }
    const withEd = (s) => (s.startsWith('+t') ? type + '+t~e' + ed + s.slice(2) : type + '~e' + ed + s);
    let ok = true;
    for (const detail of [1, 0]) for (const s of STATES) {
      const v = withEd(s);
      let a;
      try { a = m.truckFileBuild(E, v, detail); } catch (e) { problems.push(ef.file + ' ' + JSON.stringify(v) + ' detail ' + detail + ': does not build: ' + e.message); ok = false; break; }
      const st = meshStats(a.faces);
      if (!a.faces.length || st.nonFinite) { problems.push(ef.file + ' ' + JSON.stringify(v) + ' detail ' + detail + ': ' + (a.faces.length ? st.nonFinite + ' non-finite coordinates' : 'no faces')); ok = false; break; }
      const b = m.truckFileBuild(doc.params, type + s, detail);
      for (const k of ['boxHalf']) if (a.meta[k] !== b.meta[k]) { problems.push(ef.file + ' ' + JSON.stringify(v) + ': ' + k + ' differs from the stock truck\'s'); ok = false; }
      // The pin and cab back are centred per variant, so compare them uncentred.
      for (const k of ['pin', 'cabBack']) if ((a.meta[k] == null) !== (b.meta[k] == null) || (a.meta[k] != null && Math.abs((a.meta[k] + a.meta.shift) - (b.meta[k] + b.meta.shift)) > 1e-12)) {
        problems.push(ef.file + ' ' + JSON.stringify(v) + ': ' + k + ' differs from the stock truck\'s'); ok = false;
      }
      if (!ok) break;
      if (detail === 1 && s === '+t') {
        const cab0 = E.truck.geom.cab0 - a.meta.shift;
        const bad = a.faces.find((f) => !f.deck && !f.fit && f.p.some((p) => p[0] < cab0 - STACK_REACH - 1e-9 && p[2] + a.meta.drop > TRAILER_FLOOR + 0.010 + 1e-9));
        if (bad) { problems.push(ef.file + ': a ' + bad.role + ' face of the tractor stands above the trailer floor aft of the cab, in the box\'s swing'); ok = false; break; }
      }
    }
    if (!ok) continue;
    const live = m.aircraftFaces('truck', 1, false, type + '+t~e' + ed), want = m.truckFileBuild(E, type + '+t~e' + ed, 1).faces;
    if (meshDiff(live, want)) problems.push(ef.file + ': aircraftFaces(truck, ' + type + '+t~e' + ed + ') does not draw it');
  }
}

for (const n of notes) console.log('  note: ' + n);
if (problems.length) {
  console.error('meshes: ' + problems.length + ' problem(s)');
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log('meshes: ' + docs.length + ' authored mesh(es), ' + faceTotal + ' faces at full detail; ' + ported + ' converted and identical to their builders at both details.');

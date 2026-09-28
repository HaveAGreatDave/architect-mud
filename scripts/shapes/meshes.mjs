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
const { compileMesh, meshDiff, validateMesh, meshStats } = await import(VM);

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
    if (doc.params.portedFrom) {
      const legacy = m.legacyMeshFaces(doc.id, detail);
      if (!legacy) { problems.push(file + ': portedFrom ' + doc.params.portedFrom + ' but there is no builder to hold it against'); continue; }
      const d = meshDiff(faces, legacy);
      if (d) problems.push(file + ' detail ' + detail + ': differs from ' + doc.params.portedFrom + ' at face ' + d.index + ' (' + d.field + '). Run: npm run mesh -- diff ' + doc.id);
    }
  }
  if (doc.params.portedFrom) ported++;
}

// 3 — the class draws the file. Bind by what the renderer is asked for: a mesh's own id is its
// class, except one named as another file's armedMesh.
const armedOf = new Map(docs.filter((d) => d.doc.params.armedMesh).map((d) => [d.doc.params.armedMesh, d.doc.id]));
for (const { doc } of docs) {
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
  if (armedOf.has(doc.id)) continue;
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
const first = docs.find((d) => d.doc.params.portedFrom);
if (first) {
  const bent = JSON.parse(JSON.stringify(first.doc.params));
  const walk = (o) => { for (const k of Object.keys(o)) { if (typeof o[k] === 'number' && k !== 'sides' && k !== 'n') { o[k] += 1e-9; return true; } if (o[k] && typeof o[k] === 'object' && walk(o[k])) return true; } return false; };
  walk(bent.parts[0]);
  if (!meshDiff(compileMesh(bent, { detail: 1 }).faces, m.legacyMeshFaces(first.doc.id, 1))) problems.push('self-test: a nudged copy of mesh_' + first.doc.id + '.json still compares identical, so the identity check is not checking');
}

for (const n of notes) console.log('  note: ' + n);
if (problems.length) {
  console.error('meshes: ' + problems.length + ' problem(s)');
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log('meshes: ' + docs.length + ' authored mesh(es), ' + faceTotal + ' faces at full detail; ' + ported + ' converted and identical to their builders at both details.');

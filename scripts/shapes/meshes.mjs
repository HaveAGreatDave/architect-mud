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
//   6. A stock truck draws what its fingerprint says, its fittings are truck-fittings.mjs's, and the
//      renderer reads its file. 7. A truck edition keeps the stock truck's frame.
//
//   node scripts/shapes/meshes.mjs --fingerprint   takes a new truck fingerprint (section 6)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

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
    if (doc.params.portedFrom) {
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
const first = docs.find((d) => d.doc.params.portedFrom);
if (first) {
  const bent = JSON.parse(JSON.stringify(first.doc.params));
  const walk = (o) => { for (const k of Object.keys(o)) { if (typeof o[k] === 'number' && k !== 'sides' && k !== 'n') { o[k] += 1e-9; return true; } if (o[k] && typeof o[k] === 'object' && walk(o[k])) return true; } return false; };
  walk(bent.parts[0]);
  if (!meshDiff(compileMesh(bent, { detail: 1 }).faces, m.legacyMeshFaces(first.doc.id, 1))) problems.push('self-test: a nudged copy of mesh_' + first.doc.id + '.json still compares identical, so the identity check is not checking');
}

// 6 — a stock truck file (mesh_truck_<type>.json) is the truck. It was ported from a builder that held
// it exact until the builder was retired (docs/proposals/hover-rigs.md), so what holds it now is:
//   a. A fixed fingerprint (truck-fingerprint.json): what the file draws in every state a variant string
//      asks for (bobtail and hitched, running and parked, a dropped box, each fitting alone and
//      hitched, all of them at once), at both details, faces and the meta the lamps, door art and
//      articulation read. It's keyed on the file, so an unchanged file that draws differently means
//      the code that draws it moved (compileMesh, truckMeshFaces, finishTruck). An edited file asks
//      for a new fingerprint: look at the truck in the Modelshop first, then
//        node scripts/shapes/meshes.mjs --fingerprint
//   b. Its fittings are truck-fittings.mjs off its own truck block, part for part.
//   c. The renderer reads the file: nudge one number through the Modelshop override and the truck moves.
const { FITTINGS } = await import('../../plugins/trucking/fittings.js');
const CODES = Object.values(FITTINGS).map((f) => f.code), EVERY = '^' + CODES.join('.');
const STATES = ['', '+t', '~p', '+t~p', '~s', '~s~p', EVERY, '+t' + EVERY, '+t~p' + EVERY, '~p' + EVERY, '~s' + EVERY,
  ...CODES.map((c) => '^' + c), ...CODES.map((c) => '+t^' + c)];
const { createHash } = await import('node:crypto');
const sha = (s, n) => createHash('sha1').update(s).digest('hex').slice(0, n);
const FP_URL = new URL('./truck-fingerprint.json', import.meta.url);
// What a file draws from: everything but its name, its note and the editions it names.
const fileHash = (p) => { const q = { ...p }; delete q.name; delete q.note; delete q.variants; return sha(canon(q), 16); };
const stateHash = (params, v, detail) => { const b = m.truckFileBuild(params, v, detail); return sha(b.faces.map(canon).join('\n') + '\n' + canon(b.meta), 10); };
const statesHash = sha(STATES.join('|'), 10);
const stockTrucks = docs.filter((d) => d.doc.params.truck && !variantOf.has(d.doc.id));
const takeFp = process.argv.includes('--fingerprint');
let fp = null;
try { fp = JSON.parse(readFileSync(FP_URL, 'utf8')); } catch { fp = null; }
if (takeFp) {
  const trucksFp = {};
  for (const { doc } of stockTrucks) {
    const type = doc.id.replace(/^truck_/, '');
    trucksFp[type] = { file: fileHash(doc.params), d1: STATES.map((s) => stateHash(doc.params, type + s, 1)), d0: STATES.map((s) => stateHash(doc.params, type + s, 0)) };
  }
  fp = { states: statesHash, trucks: trucksFp };
  // One line per truck and detail, so a new fingerprint is a readable diff.
  const lines = ['{', '  "note": "What each stock truck file draws, state by state (meshes.mjs section 6). Taken by node scripts/shapes/meshes.mjs --fingerprint; never edit by hand.",',
    '  "states": ' + JSON.stringify(statesHash) + ',', '  "trucks": {'];
  Object.entries(trucksFp).forEach(([type, t], i, all) => {
    lines.push('    ' + JSON.stringify(type) + ': {', '      "file": ' + JSON.stringify(t.file) + ',',
      '      "d1": ' + JSON.stringify(t.d1) + ',', '      "d0": ' + JSON.stringify(t.d0), '    }' + (i < all.length - 1 ? ',' : ''));
  });
  lines.push('  }', '}', '');
  writeFileSync(FP_URL, lines.join('\n'));
  console.log('meshes: took a new truck fingerprint, ' + stockTrucks.length + ' trucks in ' + STATES.length + ' states at both details');
}
const NEW_FP = 'look at it in the Modelshop, then take a new fingerprint: node scripts/shapes/meshes.mjs --fingerprint';
let trucks = 0;
const { truckFittingParts, vintageAnchors } = await import('./truck-fittings.mjs');
if (!fp) problems.push('scripts/shapes/truck-fingerprint.json is missing or unreadable: ' + NEW_FP);
else if (fp.states !== statesHash) problems.push('the truck states have changed since the fingerprint was taken (a fitting added or removed?): ' + NEW_FP);
for (const { file, doc } of stockTrucks) {
  const type = doc.id.replace(/^truck_/, '');
  let ok = true;
  // a. The fingerprint.
  const want = fp?.states === statesHash ? fp.trucks?.[type] : null;
  if (fp && fp.states === statesHash && !want) { problems.push(file + ': no fingerprint for it: ' + NEW_FP); ok = false; }
  else if (want && want.file !== fileHash(doc.params)) { problems.push(file + ' has changed since its fingerprint was taken: ' + NEW_FP); ok = false; }
  else if (want) {
    for (const detail of [1, 0]) {
      const i = STATES.findIndex((s, k) => stateHash(doc.params, type + s, detail) !== want['d' + detail][k]);
      if (i >= 0) {
        problems.push(file + ' ' + JSON.stringify(type + STATES[i]) + ' detail ' + detail + ': draws differently from its fingerprint with the file unchanged, so compileMesh, truckMeshFaces or finishTruck changed what it draws');
        ok = false; break;
      }
    }
  }
  // b. The fittings generator (truck-fittings.mjs) off this truck's own anchors draws the file's fittings.
  const fits = doc.params.parts.find((p) => p.name === 'fittings')?.parts || [];
  const got = truckFittingParts(vintageAnchors(doc.params.truck, doc.params.truck.pods.filter((q) => !q[3]).map(([f, g]) => [f, g])));
  const at = fits.findIndex((p, i) => canon(p) !== canon(got[i]));
  if (at >= 0 || fits.length !== got.length) { problems.push(file + ': truck-fittings.mjs no longer draws its fittings (first difference at part ' + (at >= 0 ? at : Math.min(fits.length, got.length)) + ')'); ok = false; }
  // c. The renderer reads the file.
  const bent = JSON.parse(JSON.stringify(doc.params));
  bent.parts[0].parts[0].f[0] += 1e-9;
  m.setMeshOverride(doc.id, bent);
  const live = m.aircraftFaces('truck', 1, false, type);
  const moved = meshDiff(live, m.truckFileBuild(doc.params, type, 1).faces) && !meshDiff(live, m.truckFileBuild(bent, type, 1).faces);
  m.setMeshOverride(doc.id, null);
  if (!moved) { problems.push(file + ': a nudged copy draws the same truck, so the renderer is not reading the file (or the check is not checking)'); ok = false; }
  if (ok) trucks++;
}

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
console.log('meshes: ' + docs.length + ' authored mesh(es), ' + faceTotal + ' faces at full detail; ' + ported + ' converted and identical to their builders at both details; '
  + trucks + ' stock trucks held to their fingerprint in ' + STATES.length + ' states.');

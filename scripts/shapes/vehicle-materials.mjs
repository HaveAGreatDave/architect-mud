// vehicle-materials: the gate for what vehicle exteriors are made of (client/shared/vehicle-materials.js).
//
//   node scripts/shapes/vehicle-materials.mjs          (in the pretest:regress chain and in shapes:smoke)
//
// The claims:
//   1. The Drake is the standard and doesn't move by accident. Her material on every face, under
//      every scheme, both details and a spread of liveries, hashes to DRAKE_PRINT. Change her on
//      purpose and update the number in the same commit.
//   2. Every authored mesh says what its paintwork is (`finish`), or is on NO_FINISH with a reason.
//      Without one a mesh's paint is dead flat under the default satin livery, which is how every
//      aircraft but the Drake shipped.
//   3. A tyre is never metal. Wheels are role `gear`, and the gear role is a 0.45 mirror.
//   4. Every face of every vehicle, under every livery below, gets a finite value in range.
//   5. The print can fail: a Drake with one slot nudged must not hash to DRAKE_PRINT.
import { readFileSync, readdirSync } from 'node:fs';

const A = await import('../../client/game/js/panels/aircraft3d.js');
const { metalKOf, VEHICLE_MATS } = await import('../../client/shared/vehicle-materials.js');
const { compileMesh, pushWheel } = await import('../../client/shared/vehicle-mesh.js');
const { MESH_ROWS } = await import('../../client/shared/vehicle-meshes.js');

const DRAKE_PRINT = 1348574013;   // recorded against the table this replaced, which gave the same print
const NO_FINISH = {
  drake: 'her slots carry their own materials and the livery coat covers the rest, as she shipped',
  wreck: 'a wreck is drawn without materials (drawAircraftModel skips metalKOf for c.wreck)',
};
const LIVERIES = [
  null, {},
  { base: '#5a5f66', trim: '#8a9099', pattern: 'bare', finish: 'satin' },
  { base: '#aa2222', trim: '#ffffff', pattern: 'stripes', finish: 'gloss' },
  { base: '#223344', trim: '#ddeeff', pattern: 'factory', finish: 'metallic' },
  { base: '#336633', trim: '#112211', pattern: 'splinter', finish: 'matte' },
  { base: '#888888', trim: '#444444', pattern: 'bare', finish: 'candy', parts: { breast: '#ff00ff', crest: '#00ff00', hull: '#0000ff' } },
];
const problems = [];

// FNV-1a over the values, in order.
function print(faceSets) {
  let h = 0x811c9dc5;
  for (const [faces, pal] of faceSets) for (const f of faces) {
    const s = String(metalKOf(f, pal)) + ',';
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  }
  return h >>> 0;
}
function drakeSets(params) {
  const out = [];
  for (const scheme of [null, 'ivory', 'noir']) for (const detail of [0, 1]) {
    const faces = compileMesh(params, { detail, scheme }).faces;
    for (const lv of LIVERIES) out.push([faces, A.liveryPalette(lv, 'drake')]);
  }
  return out;
}

// 1
const drake = MESH_ROWS.drake;
const got = print(drakeSets(drake));
if (got !== DRAKE_PRINT) problems.push('the Drake\'s exterior materials changed: print ' + got + ', expected ' + DRAKE_PRINT + '. She is the standard; if the change is deliberate, update DRAKE_PRINT');

// 5
const nudged = JSON.parse(JSON.stringify(drake));
nudged.paints.hub.mat = 0.74;
if (print(drakeSets(nudged)) === DRAKE_PRINT) problems.push('self-test: a Drake with her hub nudged still matches DRAKE_PRINT, so claim 1 is not checking');

// 2
const DIR = new URL('../../content/vehicle_models/', import.meta.url);
for (const file of readdirSync(DIR).filter((f) => /^mesh_.+\.json$/.test(f)).sort()) {
  const doc = JSON.parse(readFileSync(new URL(file, DIR), 'utf8'));
  if (doc.params.finish == null && !NO_FINISH[doc.id]) problems.push(file + ': no `finish`. Say what its paintwork is (' + Object.keys(VEHICLE_MATS).join(', ') + ') or add it to NO_FINISH with a reason');
}

// 3 + 4
const CLASSES = [...Object.keys(MESH_ROWS).filter((id) => id !== 'heli_armed' && id !== 'wreck').map((id) => [id, false]), ['heli', true],
  ['truck', false], ['hydro', false], ['spur', false], ['gamecock', false]];
let checked = 0;
for (const [cls, armed] of CLASSES) {
  const faces = A.aircraftFaces(cls, 1, armed, '');
  const wheel = [];
  pushWheel(wheel, 0, 0, 0, 0.05, 0.02, 8);
  for (const lv of LIVERIES) {
    const pal = A.liveryPalette(lv, cls);
    for (const f of faces) {
      const k = metalKOf(f, pal); checked++;
      if (!Number.isFinite(k) || k < -0.6 || k > 0.97) { problems.push(cls + (armed ? ' (armed)' : '') + ': a ' + f.role + ' face gets ' + k); break; }
    }
    for (const f of wheel.slice(0, -2)) if (metalKOf(f, pal) > 0) { problems.push('a tyre is metal (' + metalKOf(f, pal) + ') under ' + JSON.stringify(lv)); break; }
  }
}

if (problems.length) {
  console.log('vehicle-materials: ' + problems.length + ' problem(s)');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('vehicle-materials: Drake unchanged; ' + CLASSES.length + ' classes, ' + checked + ' face materials in range');

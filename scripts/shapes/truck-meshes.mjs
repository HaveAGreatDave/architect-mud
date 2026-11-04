// truck-meshes — port the four trucks from buildTruck to mesh files (docs/proposals/hover-rigs.md).
//
//   node scripts/shapes/truck-meshes.mjs              all four
//   node scripts/shapes/truck-meshes.mjs drayman      just that one
//   then: npm run vehicles:bake
//
// Writes content/vehicle_models/mesh_truck_<type>.json. buildTruck draws one state at a time (bobtail
// or hitched, running or parked, at near or far detail, with whatever fittings), and a file has to
// hold all of them, so this records the boxes and polys buildTruck draws for each state and lays
// them out in its order with what each one needs:
//   - a part a coarser build leaves out gets `minDetail: 1`;
//   - a part a parked build leaves out (the lifter emitter bands) gets `whenNot: parked`;
//   - a part only a bobtail draws (what it carries on its bare deck) gets `whenNot: trailer`;
//   - a fitting's parts get `when: fit_<code>`, found by building with every fitting but that one;
//   - the trailer is one group, `when: trailer`, last.
// Matching is by the part's exact numbers, in order. scripts/shapes/meshes.mjs then holds every file
// to buildTruck face for face across the states, so a wrong guess here can't ship.
//
// ⚠ THIS OVERWRITES THE JSON. Run it only while buildTruck is still the source; once a truck is edited
// as a file, this script is done with it.
import { writeFileSync, readFileSync } from 'node:fs';

const m = await import('../../client/game/js/panels/aircraft3d.js');
const { formatMesh, validateMesh, compileMesh, canon } = await import('../../client/shared/vehicle-mesh.js');
const { FITTINGS } = await import('../../plugins/trucking/fittings.js');

const NAMES = { scrapper: 'Krell Barrow', hauler: 'Ostrek Courier', drayman: 'Vachon Drayman', continental: 'Orlov Continental' };
const ALL = Object.keys(NAMES);
const which = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const CODES = Object.values(FITTINGS).map((f) => f.code);
const FIT_NAME = Object.fromEntries(Object.values(FITTINGS).map((f) => [f.code, f.name]));

const rec = (v, d) => m.recordTruckBuild(v, d);
const fits = (codes) => (codes.length ? '^' + codes.join('.') : '');
// Each part of `sub` matched, in order, to a part of `sup` with the same numbers. Returns which parts
// of `sup` were matched; throws if `sub` isn't an ordered subset of `sup`.
function embed(sub, sup, what) {
  const hit = new Array(sup.length).fill(false);
  let j = 0;
  const sk = sub.map(canon);
  for (let i = 0; i < sup.length && j < sub.length; i++) if (canon(sup[i]) === sk[j]) { hit[i] = true; j++; }
  if (j !== sub.length) throw new Error(what + ': ' + (sub.length - j) + ' parts of the smaller build are not in the bigger one in order');
  return hit;
}
const tag = (p, k, v) => { p[k] = v; };

let bad = 0;
for (const type of which) {
  if (!NAMES[type]) { console.log(type, 'is not a truck type (' + ALL.join(', ') + ')'); bad++; continue; }
  const near = (v) => rec(type + v, 1), far = (v) => rec(type + v, 0);
  // ── The tractor: a bobtail with every fitting, running ──
  const bob1 = near(fits(CODES)), bob0 = far(fits(CODES));
  const tractor = bob1.parts.slice(0, bob1.fitStart);
  const kit = bob1.parts.slice(bob1.fitStart, bob1.tractorEnd);
  // Coarse: what the far build keeps.
  const tFar = embed(bob0.parts.slice(0, bob0.fitStart), tractor, type + ' tractor far');
  const kFar = embed(bob0.parts.slice(bob0.fitStart, bob0.tractorEnd), kit, type + ' fittings far');
  // Parked: what a parked bobtail keeps.
  const park = near('~p');
  const tPark = embed(park.parts.slice(0, park.fitStart), tractor, type + ' tractor parked');
  // Bobtail only: what a hitched tractor doesn't draw.
  const hit1 = near('+t');
  const tHitch = embed(hit1.parts.slice(0, hit1.fitStart), tractor, type + ' tractor hitched');
  tractor.forEach((p, i) => {
    if (!tFar[i]) tag(p, 'minDetail', 1);
    if (!tPark[i]) tag(p, 'whenNot', 'parked');
    if (!tHitch[i]) {
      if (p.whenNot) throw new Error(type + ': tractor part ' + i + ' is both parked-only and bobtail-only');
      tag(p, 'whenNot', 'trailer');
    }
  });
  // ── Each fitting: what goes missing when it's the one left off ──
  const owner = new Array(kit.length).fill(null);
  for (const code of CODES) {
    const less = near(fits(CODES.filter((c) => c !== code)));
    const kept = embed(less.parts.slice(less.fitStart, less.tractorEnd), kit, type + ' without ' + code);
    kept.forEach((k, i) => {
      if (k) return;
      if (owner[i]) throw new Error(type + ': fitting part ' + i + ' claimed by both ' + owner[i] + ' and ' + code);
      owner[i] = code;
    });
  }
  kit.forEach((p, i) => {
    if (!owner[i]) throw new Error(type + ': fitting part ' + i + ' belongs to no fitting');
    p.name = FIT_NAME[owner[i]];
    tag(p, 'when', 'fit_' + owner[i]);
    if (!kFar[i]) tag(p, 'minDetail', 1);
  });
  // ── The trailer: a hitched rig's box, running ──
  const box = hit1.parts.slice(hit1.tractorEnd);
  const bFar = embed(far('+t').parts.slice(far('+t').tractorEnd), box, type + ' trailer far');
  const hp = near('+t~p');
  const bPark = embed(hp.parts.slice(hp.tractorEnd), box, type + ' trailer parked');
  box.forEach((p, i) => {
    if (!bFar[i]) tag(p, 'minDetail', 1);
    if (!bPark[i]) tag(p, 'whenNot', 'parked');
  });

  const D = m.truckDimsForShape(type);
  // A re-run keeps the editions the file already names (the 2076 bodies hang off it).
  let variants = null;
  try { variants = JSON.parse(readFileSync(new URL('../../content/vehicle_models/mesh_truck_' + type + '.json', import.meta.url), 'utf8')).params.variants || null; } catch { /* first run */ }
  const doc = {
    id: 'truck_' + type,
    kind: 'mesh',
    params: {
      name: NAMES[type],
      note: 'Ported from buildTruck by scripts/shapes/truck-meshes.mjs. Laid out from the nose anchor at f 0.40; aircraft3d.js centres it per variant. '
        + 'Channels: trailer (+t), parked (~p), fit_<code> (^code).',
      portedFrom: 'buildTruck:' + type,
      ...(variants ? { variants } : {}),
      partIds: true,
      truck: { ...D, pods: hit1.pods.map(([f, g, r, deck, hw]) => [f, g, r, !!deck, hw]) },
      parts: [
        { kind: 'group', name: 'tractor', parts: tractor },
        { kind: 'group', name: 'fittings', parts: kit },
        { kind: 'group', name: 'trailer', when: 'trailer', parts: box },
      ],
    },
  };
  const v = validateMesh(doc.params, type);
  if (v.errors.length) { console.log(type, 'ERRORS', v.errors.slice(0, 10)); bad++; continue; }
  const n1 = compileMesh(doc.params, { detail: 1 }).faces.length, n0 = compileMesh(doc.params, { detail: 0 }).faces.length;
  writeFileSync(new URL('../../content/vehicle_models/mesh_truck_' + type + '.json', import.meta.url), formatMesh(doc));
  console.log(type, '-> mesh_truck_' + type + '.json', tractor.length + kit.length + box.length, 'parts,', n1, 'faces near,', n0, 'far (every state)');
}
process.exit(bad ? 1 : 0);

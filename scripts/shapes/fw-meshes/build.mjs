// Regenerates the five fixed-wing mesh files (content/vehicle_models/mesh_{prop,heavy,gunship,
// divebomber,locust}.json) from the builders beside this file.
//
//   node scripts/shapes/fw-meshes/build.mjs                 all five
//   node scripts/shapes/fw-meshes/build.mjs mule leviathan  just those
//   then: npm run vehicles:bake
//
// ⚠ THIS OVERWRITES THE JSON. Anything edited in the Modelshop since the last run is lost, so edit
// the builder here instead, or stop using this script for that aircraft.
//
// ⚠ THE FLIGHT DECK IS NOT NEW GEOMETRY. Each interior (client/shared/interior-*.js) is built from
// its fw_* row's hull and glass, and scripts/shapes/cockpit-*.mjs holds the room against the
// exterior's glass to 1e-6. So the stretch of hull carrying the glazing (Mule, Leviathan) or the
// canopy bubble and the rings under it (Reaper, Shrike, Locust) are lifted from the old builder
// (`setLegacyMeshes(true)`), and the new airframe is bridged onto them. Change the fw row and you
// must re-run this, or the outside and the inside drift apart.
import { writeFileSync } from 'node:fs';
const { formatMesh, validateMesh, compileMesh } = await import('../../../client/shared/vehicle-mesh.js');
const ALL = ['mule', 'leviathan', 'reaper', 'shrike', 'locust'];
const which = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
let bad = 0;
for (const name of which) {
  const doc = await (await import('./' + name + '.mjs')).default();
  const v = validateMesh(doc.params, name);
  if (v.errors.length) { console.log(name, 'ERRORS', v.errors.slice(0, 10)); bad++; continue; }
  const n1 = compileMesh(doc.params, { detail: 1 }).faces.length, n0 = compileMesh(doc.params, { detail: 0 }).faces.length;
  writeFileSync(new URL('../../../content/vehicle_models/mesh_' + doc.id + '.json', import.meta.url), formatMesh(doc));
  console.log(name, '-> mesh_' + doc.id + '.json', n1, 'faces near,', n0, 'far');
}
process.exit(bad ? 1 : 0);

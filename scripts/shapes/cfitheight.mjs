// cfitheight — the building you fly into is the building you can see.
//
//   node scripts/shapes/cfitheight.mjs
//   node scripts/shapes/cfitheight.mjs --detail
//
// ⚠ THIS EXISTS BECAUSE THE TWO HEIGHTS WERE DERIVED SEPARATELY AND NOTHING COMPARED THEM.
// The renderer draws a building's top at a world-z. The camera's eye sits at
//
//     EH = eh + climbLift · √(altitude / 3000)
//
// so in the PICTURE you are above a roof exactly when EH exceeds that z. Collision, meanwhile, was
// linear in feet — storeys × 12, scaled by how far the model extrudes past its storey stack. A
// straight line and a square root agree at one height and nowhere else, and the disagreement ran in
// BOTH directions, which is why neither half ever looked like a bug on its own:
//
//   the Solenne cleared CFIT at 161 ft while the eye only rises above its drawn roof at 339, so
//   between those you fly straight through a tower filling the windscreen — the report this came
//   from — and at the other end a shed collided to 30 ft when the eye is above it at 4, which is a
//   hit on something the player can plainly see they are over.
//
// `altForRoofZ` is the render curve read backwards, and this gate is the statement that nothing has
// gone back to converting between the two by any other route. It is not a tolerance test: the two
// numbers come from one function now, so the only correct answer is EXACTLY equal, and a non-zero
// worst case means somebody has reintroduced a second conversion.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const DETAIL = process.argv.includes('--detail');
const ws = await loadWindshield();
stubCanvas('__cfitheight', 640, 360);

const T = ws.RENDER_TUNE;
// The eye-height curve, restated here on purpose. If this gate imported the same helper the
// renderer uses it would be comparing a function with itself and would pass through any change to
// it — the point is to hold the conversion against the curve as it is WRITTEN in paintWindshield.
const eyeAlt = (z) => {
  const s = (z - T.eh) / T.climbLift;
  return s <= 0 ? 0 : Math.min(3000, 3000 * s * s);
};

const models = ws.shapeModelRegistry().filter((r) => r.key.startsWith('named:'));
// Both archetype defaults and a named model, because they take different branches of modelTopAt:
// a tile with no dedicated model falls to the square box, and a tile with one probes its segments.
const TYPES = ['office', 'apartment', 'shop', 'warehouse'];

const rows = [], problems = [];
let probes = 0;
for (const r of models) {
  const bn = r.name || r.key.slice(6);
  for (const bt of TYPES) {
    const cell = { kind: 'land', biome: 'citycore', bt, bn, ent: 'south' };
    const wx = 900, wy = 900;
    let ftMax = 0, zMax = 0;
    for (let j = -4; j <= 4; j++) {
      for (let i = -4; i <= 4; i++) {
        const px = wx + i * 0.11, py = wy + j * 0.11;
        probes++;
        const f = ws.buildingRoofFtAt(wx, wy, cell, px, py); if (f > ftMax) ftMax = f;
        const z = ws.modelTopZAt(wx, wy, cell, px, py); if (z > zMax) zMax = z;
      }
    }
    if (!(zMax > 0)) continue;
    const want = eyeAlt(zMax), err = Math.abs(ftMax - want);
    rows.push({ bn, bt, cfitFt: Math.round(ftMax), eyeFt: Math.round(want), err });
    // A tenth of a foot is float noise on a squared term; anything above it is a second conversion.
    if (err > 0.1) problems.push(`${bn} as ${bt}: CFIT clears at ${ftMax.toFixed(1)} ft, the eye clears the drawn roof at ${want.toFixed(1)} ft`);
  }
}

// ⚠ AND A BARE FIELD MUST STILL BE NOTHING. A helipad tile with no building on it has no roof, and
// the pad capture reads `padFt > 0` as "there is a building here" — so a conversion that answered a
// few feet for empty ground would arm a rooftop landing over an apron.
const bare = ws.buildingRoofFtAt(900, 900, { kind: 'field', biome: 'citycore' }, 900, 900);
if (bare !== 0) problems.push(`a bare field answers ${bare} ft of roof — it must be exactly 0`);

if (DETAIL) {
  rows.sort((a, b) => b.cfitFt - a.cfitFt);
  console.log('\n  tallest, drawn vs collided:');
  for (const r of rows.slice(0, 12)) console.log(`    ${String(r.cfitFt).padStart(5)} ft  ${r.bn} (${r.bt})`);
}

if (problems.length) {
  console.error(`\n✗ cfitheight — ${problems.length} building(s) collide at a height they are not drawn at:`);
  for (const p of problems.slice(0, 15)) console.error('  ' + p);
  if (problems.length > 15) console.error(`  …and ${problems.length - 15} more`);
  process.exit(1);
}

const tall = rows.reduce((a, r) => (r.cfitFt > a.cfitFt ? r : a), rows[0] || { cfitFt: 0, bn: '-' });
console.log(`✓ cfitheight: ${rows.length} building/type combinations over ${models.length} models, ${probes} probes — `
  + `every one collides at exactly the altitude the eye rises above its drawn roof.`);
console.log(`  Tallest is ${tall.bn} at ${tall.cfitFt} ft; a bare field is 0.`);

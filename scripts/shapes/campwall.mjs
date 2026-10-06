// NO PART OF A CAMP STANDS IN THE CURTAIN.
//
//   node scripts/shapes/campwall.mjs
//
// Old Coldwater's Pitch spills onto two Curtain tiles (927,917 and 927,918), where the wall runs down
// the tile centre. `drawTentCamp` folds everything it places onto the inland side, and the tents
// stood in the field twice anyway: once because the server sent no inland side for 927,917, and once
// because only a shelter's centre was folded, so a ridge tent turned toward the wall put its guy
// lines through it. The server half is checked in plugins/flight/regress.js; this is the drawing.
//
// `campWallSmoke` records camps against each of the four walls, on both shelter paths, and measures
// every part drawn. It can't see the picture; look at 927,918 in the game or the Modelshop.
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const res = ws.campWallSmoke();

if (!res.ran) {
  console.error('✗ campwall: no camp was recorded, so nothing was checked');
  process.exit(1);
}
if (res.length) {
  console.error(`\n✗ campwall: ${res.length} camp(s) reach into the Curtain:`);
  for (const p of res.slice(0, 20)) console.error('  · ' + p);
  if (res.length > 20) console.error(`  · …and ${res.length - 20} more`);
  console.error('\n  A shelter folds by its reach (campReach in windshield.js). A new piece of kit that');
  console.error('  reaches further than the points listed there needs a point there too.');
  process.exit(1);
}
console.log(`✓ campwall: ${res.ran} camps against four walls, both shelter paths; nothing in the field (least clearance ${res.worst.toFixed(3)} tiles).`);

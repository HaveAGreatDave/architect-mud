// Pave the road that joins The Reach to the Scarletwastes.
//
// One-shot content edit: it writes `flags.terrain = 'dirt_road'` onto 43 existing tiles under
// content/zones/ so that both regions publish a road mouth facing the other. Nothing else about
// those tiles changes, no tile is created, and the void/corridor systems derive everything else
// from the map — `regionGates` finds the new mouths, `gatePair` pairs them, and the highway between
// them is built by the same `networkRoute` that builds every other one.
//
// ⚠ THE ROUTE GOES ROUND THE MESA, NOT OVER IT. The obvious line is due west along y=957, which is
// where the Scarletwastes' existing spur already ends (x=1024, the Deadleg's apron). That line runs
// straight into the cliff-ringed plateau at x1011–1017 — and `cliff` is the ONE terrain
// `engine:impassable-terrain` refuses, so a gate reached across it is a gate nobody can walk to.
// This is the same trap the Terminus limb hit: its west rim is cliff for its whole length, and the
// obvious westward limb would have deposited a truck on a rock face. So the road drops south down
// the Deadleg's own column to y=968 and runs west along the clear ground below the mesa.
//
// Run:  node scripts/content/pave-reach-scarletwastes-road.mjs [--dry-run]
import { readFile, writeFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ZONES = join(HERE, '..', '..', 'content', 'zones');
const DRY = process.argv.includes('--dry-run');

// ── The road, as three straight runs ─────────────────────────────────────────
// `name` is set only where the region already names its roads. The Reach names them for where they
// go ("The Coldwater Road" runs west out of Main Street), so its new eastern stretch is named the
// same way. The Scarletwastes does not — its road tiles keep their place names ("The Deadleg",
// "Hardpan") and carry the road in their terrain alone — so nothing over there is renamed.
const RUNS = [
  // The Reach: east off the foot of the Field Road (911,1043) to the east rim (x=922).
  //
  // ⚠ NOT STRAIGHT OUT THE END OF MAIN STREET, AND THE REASON IS `gatePair`. Main Street runs along
  // y=1039 and paving it east to the rim puts a mouth at (922,1039) — which is 92.1 tiles from
  // Coldwater's gate, against 93.2 for the Reach's existing western one. `gatePair` takes the
  // NEAREST facing pair, so the Coldwater highway would silently have moved to the new mouth and
  // started arriving on the far side of town from the tiles named "The Coldwater Road" after it.
  // A new edge must not re-route a shipped one. Leaving by the Field Road instead puts the mouth at
  // (922,1043): further from Coldwater and Deadwater than their existing pairings, nearer to the
  // Scarletwastes than the west mouth is, so every old road keeps the exit it had and the new one
  // takes the exit that faces it. That is the whole promise of plural gates, and it is checked
  // rather than assumed — see the regress case that pins all three pairings.
  { region: 'region_the_reach', from: [912, 1043], to: [922, 1043], name: 'The Scarletwastes Road' },
  // The Scarletwastes: south down the Deadleg's column, clear of the plateau…
  { region: 'region_scarletwastes', from: [1024, 958], to: [1024, 967] },
  // …then west along the open ground beneath it, to the west rim (x=1000).
  { region: 'region_scarletwastes', from: [1000, 968], to: [1023, 968] },
];

function tilesOf(run) {
  const [x0, y0] = run.from, [x1, y1] = run.to;
  const out = [];
  if (x0 === x1) { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) out.push([x0, y]); }
  else { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) out.push([x, y0]); }
  return out;
}

const files = await readdir(ZONES);
const byXY = new Map();
for (const f of files) {
  const z = JSON.parse(await readFile(join(ZONES, f), 'utf8'));
  if (z.map_id !== 'map_world' || (z.grid_z ?? 0) !== 0) continue;
  byXY.set(`${z.grid_x},${z.grid_y}`, { z, f });
}

let changed = 0, skipped = 0;
const problems = [];
for (const run of RUNS) {
  for (const [x, y] of tilesOf(run)) {
    const hit = byXY.get(`${x},${y}`);
    if (!hit) { problems.push(`${x},${y}: no tile`); continue; }
    const { z, f } = hit;
    // ⚠ REFUSE RATHER THAN PAVE. A route that has drifted onto a cliff, a building or the wrong
    // region is a route somebody needs to look at, not one to lay tarmac over and find out later.
    if (z.flags?.region_id !== run.region) { problems.push(`${x},${y}: region ${z.flags?.region_id}`); continue; }
    if (z.flags?.terrain === 'cliff' || z.flags?.terrain === 'water') { problems.push(`${x},${y}: ${z.flags.terrain}`); continue; }
    if (z.flags?.building_type || z.flags?.is_building) { problems.push(`${x},${y}: building`); continue; }
    if (z.flags.terrain === 'dirt_road' && (!run.name || z.name === run.name)) { skipped++; continue; }
    z.flags.terrain = 'dirt_road';
    if (run.name) z.name = run.name;
    if (!DRY) await writeFile(join(ZONES, f), canonicalJson(z), 'utf8');
    changed++;
  }
}

if (problems.length) {
  console.error('REFUSED — the route does not clear:');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`${DRY ? '[dry-run] ' : ''}paved ${changed} tile(s), ${skipped} already road.`);

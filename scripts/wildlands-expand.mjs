// One-shot generator: expand the Wilds into a half-ring around Coldwater Basin.
//
// Grows the existing southern redrock band (y920-927, x891-927) into a U-shaped
// frontier that hugs the land on the south, west, and east — open to the north
// where the bay is. Three regions (all `redrock`, `district:'wilds'`, map_world z0):
//
//   South extension  x891-927  y928-947   (+20 rows)
//   West apron       x863-890  y902-947   (28 deep; land line is y902)
//   East apron       x928-955  y909-947   (28 deep; land line is y909)
//
// A small deep-west pocket (x863-868 y905-907) is left clear for future Ascendant
// frontier content. Tiles are sealed against the city by construction: a tile only
// wires an orthogonal exit to a neighbour that is itself a wilds tile (existing OR
// new), so curtain/grassland city tiles are never punched — the ring stays
// reachable only via the South Gate, exactly like the current y920 row.
//
//   node scripts/wildlands-expand.mjs                 # dry-run: print the plan
//   node scripts/wildlands-expand.mjs --write         # write the JSON files
//   node scripts/wildlands-expand.mjs --region south  # limit to one region (south|west|east|all)
//
// Deterministic: fixed updated_at + sin-hash naming (no Date.now / Math.random),
// canonicalJson bytes, idempotent (skips occupied cells; re-running is a no-op).

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, CONTENT_DIR } from './content/lib.mjs';

const WRITE = process.argv.includes('--write');
const regionArg = (process.argv.find(a => a.startsWith('--region='))?.split('=')[1])
  || (process.argv.includes('--region') ? process.argv[process.argv.indexOf('--region') + 1] : 'all');
const REGION = ['south', 'west', 'east', 'all'].includes(regionArg) ? regionArg : 'all';

const ZONES = join(CONTENT_DIR, 'zones');
const NOW = '1784700000'; // fixed, deterministic (after the existing wildlands-fill stamp)

const REDROCK = { color: '#b5744a', bg: '#2a1c16', ambient: 'wasteland' };
const NAMES = [
  'Red Hardpan', 'The Rust Flats', 'Mesa Shelf', 'Ferric Wash', 'Ochre Draw',
  'Slateback Rise', 'Cinder Mesa', 'The Ironpan', 'Rustwind Flat', 'Bloodrock Table',
  'The Scoured Plain', 'Oxide Barrens',
];
const DESCS = [
  'Cracked red hardpan runs out flat to a rust-colored horizon. Wind-scoured rock, grit, and nothing that grows.',
  'Broken mesa shelves step away in ochre and iron-red, cut by dry washes where the wind funnels grit against your teeth.',
  'A vast rust-stained plain, hammered flat and hard, printed here and there with the tracks of things that crossed it once.',
];

// Fixed-hash pick (repo convention: sin-hash, never Math.random).
function hpick(arr, x, y, salt = 0) {
  const h = Math.abs(Math.sin((x * 127.1 + y * 311.7 + salt * 53.3)) * 43758.5453);
  return arr[Math.floor((h - Math.floor(h)) * arr.length)];
}

// The three regions and the reserve pocket.
const REGIONS = {
  south: { x: [891, 927], y: [928, 947], depthOf: (x, y) => y - 919 },
  west: { x: [863, 890], y: [902, 947], depthOf: (x, y) => 891 - x },
  east: { x: [928, 955], y: [909, 947], depthOf: (x, y) => x - 927 },
};
const RESERVE = { x: [863, 868], y: [905, 907] }; // future Ascendant frontier
const inBox = (b, x, y) => x >= b.x[0] && x <= b.x[1] && y >= b.y[0] && y <= b.y[1];

// Gentle radiation gradient: hotter the deeper into the frontier.
const radFor = (depth) => Math.min(45, 25 + Math.round(depth * 0.6));

// ── Load current occupancy (map_world z0) from disk ──────────────────────────
// cellKey -> { id, isWilds }. Only need occupancy + wilds-ness for exit wiring.
const cells = new Map();
const key = (x, y) => `${x}_${y}`;
for (const f of readdirSync(ZONES)) {
  if (!f.endsWith('.json')) continue;
  const z = JSON.parse(readFileSync(join(ZONES, f), 'utf8'));
  if (z.map_id !== 'map_world' || (z.grid_z ?? 0) !== 0) continue;
  cells.set(key(z.grid_x, z.grid_y), { id: z.id, isWilds: z.flags?.district === 'wilds' });
}

// ── Enumerate the new cells ──────────────────────────────────────────────────
const wanted = REGION === 'all' ? ['south', 'west', 'east'] : [REGION];
const newTiles = []; // { x, y, region }
for (const name of wanted) {
  const r = REGIONS[name];
  for (let x = r.x[0]; x <= r.x[1]; x++) {
    for (let y = r.y[0]; y <= r.y[1]; y++) {
      if (cells.has(key(x, y))) continue;          // occupied — skip
      if (inBox(RESERVE, x, y)) continue;          // Ascendant reserve pocket
      newTiles.push({ x, y, region: name });
    }
  }
}
// Register the new cells as wilds so exit wiring can join new↔new.
for (const t of newTiles) cells.set(key(t.x, t.y), { id: `zone_district_${t.x}_${t.y}`, isWilds: true, isNew: true });

// ── Build tile objects + wire exits (sealing rule) ───────────────────────────
const DIRS = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
const OPP = { north: 'south', south: 'north', west: 'east', east: 'west' };
const rewriteExisting = new Map(); // existingId -> { dir: newId }

function tileFor({ x, y, region }) {
  const depth = REGIONS[region].depthOf(x, y);
  const exits = {};
  for (const [dir, [dx, dy]] of Object.entries(DIRS)) {
    const n = cells.get(key(x + dx, y + dy));
    if (!n || !n.isWilds) continue;               // only ever join wilds tiles
    exits[dir] = n.id;
    if (!n.isNew) {                               // reciprocal into an existing file
      if (!rewriteExisting.has(n.id)) rewriteExisting.set(n.id, {});
      rewriteExisting.get(n.id)[OPP[dir]] = `zone_district_${x}_${y}`;
    }
  }
  return {
    ambient_events: [],
    ambient_theme: REDROCK.ambient,
    audio_theme_id: null,
    bg_color: REDROCK.bg,
    color: REDROCK.color,
    created_by: 'wildlands-expand',
    description: hpick(DESCS, x, y, 7),
    exits,
    flags: { district: 'wilds', planner: 'bp_district', radiation: radFor(depth), terrain: 'redrock' },
    grid_x: x,
    grid_y: y,
    grid_z: 0,
    id: `zone_district_${x}_${y}`,
    map_id: 'map_world',
    marker: null,
    name: hpick(NAMES, x, y),
    parent_zone: null,
    updated_at: NOW,
  };
}

const built = newTiles.map(tileFor);

// ── Report ───────────────────────────────────────────────────────────────────
const byRegion = wanted.map(r => `${r}: ${newTiles.filter(t => t.region === r).length}`).join(', ');
console.log(`Region(s): ${wanted.join('+')}`);
console.log(`New wilds tiles: ${built.length}  (${byRegion})`);
console.log(`Existing wilds tiles gaining a reciprocal exit: ${rewriteExisting.size}`);
if (!WRITE) {
  console.log('\nDry run — pass --write to author the files. Sample:');
  for (const t of built.slice(0, 3)) console.log(`  ${t.id}  "${t.name}"  rad ${t.flags.radiation}  exits=${Object.keys(t.exits).join('/')}`);
  process.exit(0);
}

// ── Write ─────────────────────────────────────────────────────────────────────
let wrote = 0, patched = 0;
for (const t of built) {
  writeFileSync(join(ZONES, `${t.id}.json`), canonicalJson(t));
  wrote++;
}
for (const [id, adds] of rewriteExisting) {
  const path = join(ZONES, `${id}.json`);
  if (!existsSync(path)) continue;
  const z = JSON.parse(readFileSync(path, 'utf8'));
  z.exits = { ...(z.exits || {}), ...adds };
  writeFileSync(path, canonicalJson(z));
  patched++;
}
console.log(`\nWrote ${wrote} new tiles, patched ${patched} existing edge tiles.`);

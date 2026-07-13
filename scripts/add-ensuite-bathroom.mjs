// add-ensuite-bathroom.mjs — stamp a lockable ensuite bathroom onto any room.
//
// Given a parent zone id, this writes content JSON (git as source of truth) for:
//   • a bathroom sub-zone reached via a non-spatial `in`/`out` exit (no grid
//     cell consumed, map_id:null — see DIR_OFFSET.in in directions.js)
//   • a privacylock door anchored on the bathroom side (privacySide = bathroom),
//     so only someone *inside* can throw the bolt and nobody enters while it's
//     occupied (plugins/doors/index.js registers the privacylock type)
//   • toilet + sink + shower fixtures the bodily plugin already gives verbs to
//     (pee/poop/flush on the toilet, wash on the sink, shower on the shower)
// …and patches the parent zone's exits to add `in → <bathroom>`.
//
// It only writes files — nothing touches the DB. Load them the normal way:
//   npm run content:import   (local)   /   push to main (CODEX deploy → prod)
//
// Usage:
//   node scripts/add-ensuite-bathroom.mjs <parentZoneId> [options]
// Options:
//   --name "<zone name>"   bathroom zone name    (default: "<parent name> — Bathroom")
//   --desc "<description>"  bathroom description  (default: a generic clean head)
//   --dir  <in|up|down>    exit off the parent   (default: in)
//   --id   <bathZoneId>    bathroom zone id      (default: <parentId>_bath)
//
// Idempotent: re-running skips a bathroom that already exists.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, CONTENT_DIR } from './content/lib.mjs';
import { OPPOSITE } from '../server/engine/directions.js';

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const positional = [];
const opts = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[++i];
  else positional.push(argv[i]);
}
const parentId = positional[0];
if (!parentId) {
  console.error('Usage: node scripts/add-ensuite-bathroom.mjs <parentZoneId> [--name .. --desc .. --dir in --id ..]');
  process.exit(1);
}

const parentDir = opts.dir || 'in';
if (!OPPOSITE[parentDir]) { console.error(`Unknown direction "${parentDir}".`); process.exit(1); }
const bathDir = OPPOSITE[parentDir]; // the bathroom's exit back to the parent

const sanitize = (id) => id.replace(/[^A-Za-z0-9._-]/g, '_');
const zonePath = (id) => join(CONTENT_DIR, 'zones', `${sanitize(id)}.json`);

// ── read + validate the parent ───────────────────────────────────────────────
const parentPath = zonePath(parentId);
if (!existsSync(parentPath)) { console.error(`Parent zone file not found: ${parentPath}`); process.exit(1); }
const parent = JSON.parse(readFileSync(parentPath, 'utf8'));
parent.exits = parent.exits || {};

const bathId = opts.id || `${parentId}_bath`;

// idempotency
if (existsSync(zonePath(bathId))) {
  console.log(`✓ ${bathId} already exists — nothing to do.`);
  process.exit(0);
}
if (parent.exits[parentDir]) {
  console.error(`Parent already has an "${parentDir}" exit (→ ${parent.exits[parentDir]}). Pass a free --dir.`);
  process.exit(1);
}

const bathName = opts.name || `${parent.name || parentId} — Bathroom`;
const bathDesc = opts.desc ||
  `A compact private head. A toilet, a small sink, and a walk-in shower stall — everything you need to make yourself clean and presentable. The bolt on the hatch slides shut for privacy.`;

const doorId = `door_${bathId}`;
const write = (rel, obj) => {
  const p = join(CONTENT_DIR, rel);
  writeFileSync(p, canonicalJson(obj));
  console.log(`  + ${rel}`);
};

// ── bathroom zone ─────────────────────────────────────────────────────────────
// Reached only by a non-spatial exit, so it needs no grid cell (map_id:null,
// grid 0/0/0). parent_zone ties it into the building hierarchy.
write(`zones/${sanitize(bathId)}.json`, {
  ambient_events: [],
  ambient_theme: 'indoors',
  audio_theme_id: null,
  bg_color: parent.bg_color || '#3a3f44',
  color: null,
  created_by: 'add-ensuite-bathroom',
  description: bathDesc,
  exits: { [bathDir]: parentId },
  flags: { is_interior: true },
  grid_x: 0, grid_y: 0, grid_z: 0,
  id: bathId,
  map_id: null,
  marker: null,
  name: bathName,
  parent_zone: parentId,
});

// ── privacylock door ──────────────────────────────────────────────────────────
// Anchored on the bathroom side (zone_id = bath, exit_dir = bathDir) with
// target_zone pinned to the parent, so getDoorForExit resolves it from BOTH
// directions of travel (movement.js:392). authFn lets only someone standing on
// privacySide (the bathroom) lock/unlock; passWhileLocked:false keeps everyone
// out while it's bolted.
write(`doors/${doorId}.json`, {
  door_type: 'basic',
  exit_dir: bathDir,
  flags: {},
  hololock_difficulty: 5,
  hp: 1000,
  hp_max: 1000,
  id: doorId,
  is_locked: 0,
  is_open: 0,
  lock_state: 'unlocked',
  name: null,
  tags: {
    'lock:privacylock': {
      messages: {
        denied: 'The privacy bolt only works from the other side.',
        lock: 'You slide the privacy bolt shut.',
        unlock: 'You slide the privacy bolt open.',
      },
      privacySide: bathId,
    },
  },
  target_zone: parentId,
  zone_id: bathId,
});

// ── fixtures (bodily plugin already wires their verbs) ────────────────────────
const fixture = (suffix, extra) => ({
  description: extra.description,
  flags: extra.flags || {},
  hp: null,
  hp_max: null,
  id: `furn_${sanitize(bathId)}_${suffix}`,
  light_type: null,
  lumen_output: null,
  name: extra.name,
  object_type: extra.object_type,
  power_draw_kw: null,
  price: 0,
  zone_id: bathId,
});

write(`furniture/furn_${sanitize(bathId)}_toilet.json`, fixture('toilet', {
  name: 'toilet',
  object_type: 'toilet',
  description: 'A clean white toilet. It flushes. In this city, that is a small miracle.',
}));
write(`furniture/furn_${sanitize(bathId)}_sink.json`, fixture('sink', {
  name: 'sink',
  object_type: 'sink',
  flags: { water_source: true },
  description: 'A wall-mounted basin with a single tap that runs cold, clean water — enough to drink, or to wash the day off your hands.',
}));
write(`furniture/furn_${sanitize(bathId)}_shower.json`, fixture('shower', {
  name: 'shower',
  object_type: 'shower',
  description: 'A walk-in shower stall behind a glass panel. Hot water, real pressure. Step in and get clean.',
}));

// ── patch the parent exit ─────────────────────────────────────────────────────
parent.exits[parentDir] = bathId;
writeFileSync(parentPath, canonicalJson(parent));
console.log(`  ~ zones/${sanitize(parentId)}.json  (exits.${parentDir} → ${bathId})`);

console.log(`\n✓ Ensuite bathroom stamped: ${bathId}`);
console.log(`  Next: npm run content:import   (then npm run test:regress), or push to deploy.`);

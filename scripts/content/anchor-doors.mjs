// ONE-SHOT: anchor every door to its connection, and collapse the doubles.
//
//   node scripts/content/anchor-doors.mjs [--write]
//
// A door was identified by (zone_id, exit_dir) — a coordinate, and therefore the
// P1 failure the connection ids exist to stop. Two consequences, both measured:
//
//   1. 56 of 117 door SEAMS carried TWO rows, one authored from each side
//      (`..._in` and `..._out`). All 56 pairs are field-for-field identical today,
//      but nothing holds them that way: they have two lock_states, two hp pools and
//      two tag sets, which is "a door open in look and locked on move" waiting to
//      happen (spec §12) and the 57-orphan bug of §6.3.
//   2. 48 rows sat on bare geometry with no authored id to be keyed by at all,
//      which would have left connection_locks (§6.1) unable to lock a quarter of
//      the world's doors. mint-connections.mjs now mints those seams.
//
// This writes `connection_id` onto the survivor of each seam and deletes the
// duplicate. Survivor rule: the row already sitting on the connection's `a` side,
// so no row changes which zone it belongs to; ties break on the lexicographically
// smaller id. `target_zone` is filled in where it was null, so a door states its
// own far side instead of re-deriving it from zones.exits.
//
// Idempotent: a second run finds every door anchored and does nothing.

import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';
import { OPPOSITE } from './derive.mjs';

const WRITE = process.argv.includes('--write');

const readDir = (t) => {
  const d = path.join(CONTENT_DIR, t);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.json'))
    .map(f => ({ file: path.join(d, f), data: JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) }));
};

const zones = new Map(readDir('zones').map(z => [z.data.id, z.data]));
const connections = readDir('connections').map(c => c.data);
const doors = readDir('doors');

// Seam index. A blocked connection is a wall and can hold no fixture.
const bySeam = new Map();
for (const c of connections) {
  if (c.blocked) continue;
  bySeam.set([c.a, c.b].sort().join('~'), c);
}

const farSides = (d) => {
  if (d.target_zone) return [d.target_zone];
  const v = zones.get(d.zone_id)?.exits?.[d.exit_dir];
  return v ? (Array.isArray(v) ? v : [v]).filter(Boolean) : [];
};

// Group every door by the connection it sits on.
const byConn = new Map();
const unanchored = [];
for (const d of doors) {
  const far = farSides(d.data);
  const conn = far.map(t => bySeam.get([d.data.zone_id, t].sort().join('~'))).find(Boolean);
  if (!conn) { unanchored.push(d); continue; }
  if (!byConn.has(conn.id)) byConn.set(conn.id, { conn, doors: [] });
  byConn.get(conn.id).doors.push(d);
}

if (unanchored.length) {
  console.error(`✗ ${unanchored.length} door(s) sit on no connection — run mint-connections.mjs first:`);
  for (const d of unanchored.slice(0, 10)) console.error(`   ${d.data.id}  ${d.data.zone_id} -${d.data.exit_dir}-> ${d.data.target_zone ?? '(via exits)'}`);
  process.exit(1);
}

const FIELDS = ['door_type', 'hp', 'hp_max', 'is_open', 'is_locked', 'lock_state',
  'hololock_difficulty', 'name', 'tags', 'flags'];

const updates = [];
const deletions = [];
let conflicts = 0;
for (const { conn, doors: group } of [...byConn.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(e => e[1])) {
  const sorted = [...group].sort((x, y) => x.data.id.localeCompare(y.data.id));
  // Prefer the row already on the connection's `a` side: keeping it means no door
  // changes which zone it belongs to, so ids stay honest about where they are.
  const keep = sorted.find(d => d.data.zone_id === conn.a) || sorted[0];
  const drop = sorted.filter(d => d !== keep);

  // Refuse to collapse two rows that disagree — that is a content decision, not a
  // mechanical one, and picking a winner silently would discard somebody's edit.
  for (const d of drop) {
    const differing = FIELDS.filter(f => JSON.stringify(d.data[f]) !== JSON.stringify(keep.data[f]));
    if (differing.length) {
      console.error(`✗ ${conn.id}: ${keep.data.id} and ${d.data.id} differ on ${differing.join(', ')} — resolve by hand`);
      conflicts++;
    }
  }
  if (conflicts) continue;

  const far = keep.data.zone_id === conn.a ? conn.b : conn.a;
  const next = { ...keep.data, connection_id: conn.id, target_zone: keep.data.target_zone ?? far };
  if (JSON.stringify(next) !== JSON.stringify(keep.data)) updates.push({ file: keep.file, data: next });
  deletions.push(...drop);
}
if (conflicts) { console.error(`\n✗ ${conflicts} conflicting pair(s); nothing written.`); process.exit(1); }

console.log(`doors ${doors.length} on ${byConn.size} connections`);
console.log(`  anchor/update: ${updates.length}`);
console.log(`  delete as duplicate: ${deletions.length}`);
if (deletions.length) console.log('  e.g. ' + deletions.slice(0, 5).map(d => d.data.id).join(', '));

if (!WRITE) { console.log('\n(dry run — pass --write to apply)'); process.exit(0); }
for (const u of updates) fs.writeFileSync(u.file, canonicalJson(u.data), 'utf8');
for (const d of deletions) fs.unlinkSync(d.file);
console.log(`✓ ${updates.length} door file(s) anchored, ${deletions.length} duplicate(s) removed.`);

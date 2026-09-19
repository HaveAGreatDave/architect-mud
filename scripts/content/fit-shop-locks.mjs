// ONE-SHOT: fit every scheduled shop's front door with a lock.
//
//   node scripts/content/fit-shop-locks.mjs [--write]
//
// Shop hours shipped as a MOVE GATE and nothing else. Measured before this ran:
// of the 84 zones a scheduled vendor keeps shop in, **49 had no `doors` row on
// their entrance at all** and **32 more had a door carrying no lock**, which is
// the same defect twice — `npcAutoLockable` needs a lock tag, so even the
// shopkeeper's own lock-up-on-the-way-home step in ai-behaviour.js never fired
// for any of them. A player at a closed shopfront got "The door won't give" with
// nothing there to unlock, hack or batter.
//
// Two things happen here, and nothing else:
//
//   1. A shop entrance that ALREADY has a door and no lock gets `lock:shoplock`.
//   2. A shop entrance with NO door gets one, on the connection the map pipeline
//      has already marked `lockable: true`.
//
// ⚠ `connections.lockable` IS THE AUTHORING SIGNAL, AND IT HAD NO READER. The
// schema's own comment is "a lock MAY be installed here (§6)"; nothing in the
// server has ever read the column. This script is the first thing to, which is
// why it can only ever fit a lock where a human already said one could go — it
// never invents a seam, and the 12 shops whose entrance is not marked lockable
// (an open yard, an arcade concourse, a lobby, a salon 18 floors up) are listed
// and left alone.
//
// ⚠ IT NEVER TOUCHES A DOOR THAT ALREADY HAS A LOCK. A shop behind a hololock,
// a keycard or the Watch's blast door is a shop somebody made a decision about.
//
// ⚠ AND THE ENTRANCE IS THE STREET DOOR, NOT ANY DOOR TOUCHING THE SHOP. A back
// office or a cold store also borders the sales floor; locking one of those at
// closing time seals the stockroom and does nothing to the shopfront. The test is
// the same one plugins/commerce/shopdoor.js runs at runtime: the link from the
// shop to its own `flags.world_exit_zone`.
//
// Idempotent: a second run finds every shop fitted and does nothing.

import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';

const WRITE = process.argv.includes('--write');

const readDir = (t) => {
  const d = path.join(CONTENT_DIR, t);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.json'))
    .map(f => ({ file: path.join(d, f), data: JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) }));
};

const zones = new Map(readDir('zones').map(z => [z.data.id, z.data]));
const npcs = readDir('npcs').map(n => n.data);
const connections = readDir('connections').map(c => c.data);
const doorFiles = readDir('doors');

// The lock, exactly as plugins/commerce/shopdoor.js registers its defaults. Written
// onto the row so a door states its own terms, which is what every other authored
// lock in content/doors does.
const SHOP_LOCK = {
  canHack: true,
  difficulty: 4,
  messages: {
    denied: 'The shop lock reads your hand and declines to recognise it.',
    lock: 'The bolt drops and the shopfront goes quiet.',
    unlock: 'The bolt lifts. The shop door swings in.',
  },
};

// Which zones are shops? The same three tests the runtime index runs: somebody
// with stock, a timetable, and a counter to stand behind.
const shopZones = new Map();
for (const n of npcs) {
  if (!n.work_zone_id || n.flags?.covert) continue;
  if (!(n.vendor_inventory || []).length) continue;
  if (!n.vendor_schedule || !Object.keys(n.vendor_schedule).length) continue;
  if (!shopZones.has(n.work_zone_id)) shopZones.set(n.work_zone_id, []);
  shopZones.get(n.work_zone_id).push(n);
}

const lockTagsOf = (d) => Object.keys(d.tags || {}).filter(k => k.startsWith('lock:'));
const between = (x, y) => connections.filter(c => (c.a === x && c.b === y) || (c.a === y && c.b === x));

// A door is the shop's entrance if it stands on the step between the shop and the
// zone its `world_exit_zone` names. Anchored on either end: a door row records one
// side, and which side is an accident of who authored it.
function entranceDoorFor(zoneId, streetId) {
  return doorFiles.find(({ data: d }) =>
    (d.zone_id === zoneId && d.target_zone === streetId) ||
    (d.zone_id === streetId && d.target_zone === zoneId) ||
    (d.connection_id && between(zoneId, streetId).some(c => c.id === d.connection_id)));
}

const report = { tagged: [], fitted: [], hasLock: [], noStreet: [], notLockable: [] };
const writes = [];

for (const [zoneId] of shopZones) {
  const zone = zones.get(zoneId);
  if (!zone) continue;
  const street = zone.flags?.world_exit_zone;
  if (!street) { report.noStreet.push([zoneId, zone.name]); continue; }

  const existing = entranceDoorFor(zoneId, street);
  if (existing) {
    if (lockTagsOf(existing.data).length) { report.hasLock.push([zoneId, zone.name, lockTagsOf(existing.data).join(',')]); continue; }
    existing.data.tags = { ...(existing.data.tags || {}), 'lock:shoplock': SHOP_LOCK };
    // A door with no lock has no lock_state to speak of. Give it the authored one
    // the rest of content/doors uses; the runtime sync corrects it to the clock
    // within thirty seconds of boot either way.
    existing.data.lock_state = 'locked';
    writes.push([existing.file, existing.data]);
    report.tagged.push([zoneId, zone.name, existing.data.id]);
    continue;
  }

  const lockable = between(zoneId, street).filter(c => c.lockable);
  if (!lockable.length) { report.notLockable.push([zoneId, zone.name]); continue; }

  // One fixture per connection (schema: idx_doors_connection is UNIQUE), so the
  // seam picks itself: the lockable one. Where the pipeline marked both directions
  // lockable, the shop's own side wins, because a door belongs to the premises it
  // shuts rather than to the pavement outside it.
  const conn = lockable.find(c => c.a === zoneId) || lockable[0];
  const id = `door_shop_${zoneId.replace(/^zone_/, '')}`;
  const row = {
    connection_id: conn.id,
    door_type: 'basic',
    exit_dir: conn.dir,
    flags: {},
    hololock_difficulty: 5,
    hp: 1000,
    hp_max: 1000,
    id,
    is_locked: 0,
    is_open: 0,
    lock_state: 'locked',
    name: null,
    tags: { 'lock:shoplock': SHOP_LOCK },
    // ⚠ THE PAIR IS (conn.a, conn.b), NEVER (conn.a, "the shop"). `exit_dir` is
    // conn.dir, which is the direction FROM conn.a, so zone_id has to be conn.a and
    // target_zone has to be its other end. Writing the shop's far side instead gave
    // 30 of these rows zone_id === target_zone — a door standing on the step from a
    // tile to itself — on every seam the pipeline happened to anchor street-side.
    target_zone: conn.b,
    zone_id: conn.a,
  };
  writes.push([path.join(CONTENT_DIR, 'doors', `${id}.json`), row]);
  report.fitted.push([zoneId, zone.name, id, conn.id]);
}

const show = (label, rows) => {
  console.log(`\n${label} (${rows.length})`);
  for (const r of rows) console.log('  ' + r.join(' | '));
};
show('FITTED a new shop door', report.fitted);
show('TAGGED an existing bare door', report.tagged);
show('LEFT ALONE, already locked', report.hasLock);
show('SKIPPED, no world_exit_zone', report.noStreet);
show('SKIPPED, entrance connection not marked lockable', report.notLockable);

if (!WRITE) {
  console.log(`\nDRY RUN. ${writes.length} file(s) would be written. Re-run with --write.`);
} else {
  for (const [file, data] of writes) fs.writeFileSync(file, canonicalJson(data));
  console.log(`\n✓ ${writes.length} file(s) written.`);
}

// ONE-SHOT: fit every apartment's front door with a hololock.
//
//   node scripts/content/fit-apartment-hololocks.mjs [--write]
//
// A flat's front door is the step from an `is_apartment` zone to a room that isn't part of the flat: a landing,
// a hall, a stair. Before this ran, 54 of those steps had a hololock and the rest were open archways, so a tenant
// had nothing to close or lock behind them and `lock` only set a flag on the tenancy.
//
// For each front door:
//   1. A door with a lock already on it is left alone, whatever the lock is.
//   2. A door with no lock gets `lock:hololock`.
//   3. A step with no door gets one, on the pair's connection file, and a connection file where the step came
//      from the grid alone. An unblocked connection over a grid edge claims that edge and changes no exit.
//
// What isn't a front door: a step to another flat, and a step to one of the flat's own rooms (its id starts with
// the flat's, as `zone_apt_1_bath` does). Those keep what they have.
//
// The lock is written `locked`, as every authored hololock is. On a flat nobody rents that lock is vestigial
// (doorGuardsOnlyUnownedApartment), so the door still opens to anyone.
//
// Idempotent: a second run finds every flat fitted and does nothing.

import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';

const WRITE = process.argv.includes('--write');
const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up', in: 'out', out: 'in',
  northeast: 'southwest', southwest: 'northeast', northwest: 'southeast', southeast: 'northwest' };

const readDir = (t) => {
  const d = path.join(CONTENT_DIR, t);
  return fs.readdirSync(d).filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: path.join(d, f), data: JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) }));
};

const zones = new Map(readDir('zones').map((z) => [z.data.id, z.data]));
const connections = readDir('connections').map((c) => c.data);
const doorFiles = readDir('doors');
const connIds = new Set(connections.map((c) => c.id));
const doorIds = new Set(doorFiles.map((d) => d.data.id));
const doorByConn = new Map(doorFiles.filter((d) => d.data.connection_id).map((d) => [d.data.connection_id, d]));

// as plugins/doors registers it; the registry's defaults supply the lines
const HOLOLOCK = { canHack: true, difficulty: 5 };
const hasLock = (d) => Object.keys(d.tags || {}).some((k) => k.startsWith('lock:'));
const between = (x, y) => connections.filter((c) => !c.blocked && ((c.a === x && c.b === y) || (c.a === y && c.b === x)));
const slug = (id) => id.replace(/^zone_/, '');
const fresh = (base, taken) => { let id = base, n = 2; while (taken.has(id)) id = `${base}_${n++}`; taken.add(id); return id; };

const report = { fitted: [], linked: [], tagged: [], hasLock: [], skipped: [] };
const writes = [];

for (const zone of [...zones.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
  if (!zone.flags?.is_apartment) continue;
  for (const [dir, v] of Object.entries(zone.exits || {})) {
    for (const farId of (Array.isArray(v) ? v : [v])) {
      const far = zones.get(farId);
      if (!far) continue;
      if (far.flags?.is_apartment || far.id.startsWith(zone.id + '_')) { report.skipped.push([zone.id, dir, far.id]); continue; }

      const conns = between(zone.id, far.id);
      const existing = conns.map((c) => doorByConn.get(c.id)).find(Boolean)
        || doorFiles.find(({ data: d }) => (d.zone_id === zone.id && d.target_zone === far.id) || (d.zone_id === far.id && d.target_zone === zone.id));
      if (existing) {
        if (hasLock(existing.data)) { report.hasLock.push([zone.id, existing.data.id]); continue; }
        existing.data.tags = { ...(existing.data.tags || {}), 'lock:hololock': HOLOLOCK };
        existing.data.lock_state = 'locked';
        writes.push([existing.file, existing.data]);
        report.tagged.push([zone.id, existing.data.id]);
        continue;
      }

      let conn = conns[0];
      if (!conn) {
        if (!OPPOSITE[dir]) { report.skipped.push([zone.id, dir, far.id, 'no way back']); continue; }
        conn = { a: zone.id, b: far.id, blocked: false, dir, id: fresh(`conn_${slug(zone.id)}_${dir}`, connIds), lockable: true, one_way: false };
        connections.push(conn);
        writes.push([path.join(CONTENT_DIR, 'connections', `${conn.id}.json`), conn]);
        report.linked.push([zone.id, conn.id]);
      }
      const id = fresh(`door_${slug(zone.id)}`, doorIds);
      // the pair is (conn.a, conn.b) and the direction conn.dir, which runs from conn.a
      const row = {
        connection_id: conn.id, door_type: 'basic', exit_dir: conn.dir, flags: {}, hololock_difficulty: 5,
        hp: 1000, hp_max: 1000, id, is_locked: 0, is_open: 0, lock_state: 'locked', name: `${zone.name} door`,
        tags: { 'lock:hololock': HOLOLOCK }, target_zone: conn.b, zone_id: conn.a,
      };
      const file = path.join(CONTENT_DIR, 'doors', `${id}.json`);
      doorFiles.push({ file, data: row });
      doorByConn.set(conn.id, { file, data: row });
      writes.push([file, row]);
      report.fitted.push([zone.id, id, conn.id]);
    }
  }
}

const show = (label, rows, all = true) => {
  console.log(`\n${label} (${rows.length})`);
  if (all) for (const r of rows) console.log('  ' + r.join(' | '));
};
show('FITTED a new door with a hololock', report.fitted);
show('WROTE a connection file for it', report.linked, false);
show('TAGGED an existing bare door', report.tagged);
show('LEFT ALONE, already locked', report.hasLock, false);
show('SKIPPED, not a front door', report.skipped);

if (!WRITE) {
  console.log(`\nDRY RUN. ${writes.length} file(s) would be written. Re-run with --write.`);
} else {
  for (const [file, data] of writes) fs.writeFileSync(file, canonicalJson(data));
  console.log(`\n✓ ${writes.length} file(s) written.`);
}
